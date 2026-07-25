import { randomUUID } from 'node:crypto';
import type { CreateTokenEventInput, TokenEvent } from '../domain/event.js';
import { createTokenEvent } from '../domain/event.js';
import type { TokenLifecycleStatus, TokenMarketSnapshot } from '../domain/token.js';
import { eventRepository, tokenRepository, type PersistedEventResult } from '../storage/dataCloud/index.js';

export interface EventEngineOptions {
  persistenceEnabled?: boolean;
  throwOnPersistenceError?: boolean;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface EmitEventResult {
  event: TokenEvent;
  persisted: boolean;
  duplicate: boolean;
  eventId: string | null;
  error?: Error;
}

type EventSubscriber = (event: TokenEvent, result: EmitEventResult) => void | Promise<void>;

function numberFromPayload(payload: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function stringFromPayload(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function lifecycleForEvent(eventType: string): TokenLifecycleStatus {
  switch (eventType) {
    case 'WATCHLIST_ENTERED': return 'WATCHLIST';
    case 'ALERT_GENERATED':
    case 'ALERT_SENT': return 'ALERTED';
    case 'DEX_MIGRATED': return 'MIGRATED';
    case 'TOKEN_DIED': return 'DEAD';
    case 'TOKEN_UPDATED':
    case 'LIQUIDITY_ADDED':
    case 'SMART_WALLET_BUY': return 'ACTIVE';
    default: return 'DISCOVERED';
  }
}

function marketFromEvent(event: TokenEvent): TokenMarketSnapshot | null {
  const payload = event.payload ?? {};
  const market: TokenMarketSnapshot = {
    capturedAt: event.occurredAt,
    priceUsd: numberFromPayload(payload, 'priceUsd', 'price', 'currentPrice'),
    marketCapUsd: numberFromPayload(payload, 'marketCapUsd', 'marketCap', 'market_cap'),
    liquidityUsd: numberFromPayload(payload, 'liquidityUsd', 'liquidity'),
    volume5mUsd: numberFromPayload(payload, 'volume5mUsd', 'volume5m', 'volume_5m'),
    buys5m: numberFromPayload(payload, 'buys5m', 'buys_5m'),
    sells5m: numberFromPayload(payload, 'sells5m', 'sells_5m'),
    holderCount: numberFromPayload(payload, 'holderCount', 'holders'),
  };

  const hasMarketData = Object.entries(market)
    .some(([key, value]) => key !== 'capturedAt' && value !== null && value !== undefined);

  return hasMarketData ? market : null;
}

function persistedKey(event: TokenEvent): string {
  const windowSeconds = Math.max(0, event.deduplicationWindowSeconds ?? 0);
  if (windowSeconds === 0) return `${event.eventKey}:${randomUUID()}`;

  const occurredMs = new Date(event.occurredAt).getTime();
  const safeMs = Number.isFinite(occurredMs) ? occurredMs : Date.now();
  const bucket = Math.floor(safeMs / (windowSeconds * 1000));
  return `${event.eventKey}:w${windowSeconds}:${bucket}`;
}

export class EventEngine {
  private readonly persistenceEnabled: boolean;
  private readonly throwOnPersistenceError: boolean;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly subscribers = new Map<string, Set<EventSubscriber>>();

  constructor(options: EventEngineOptions = {}) {
    this.persistenceEnabled = options.persistenceEnabled
      ?? process.env.DATA_CLOUD_PERSISTENCE_ENABLED !== 'false';
    this.throwOnPersistenceError = options.throwOnPersistenceError
      ?? process.env.DATA_CLOUD_STRICT_MODE === 'true';
    this.logger = options.logger ?? console;
  }

  subscribe(eventType: string | '*', subscriber: EventSubscriber): () => void {
    const existing = this.subscribers.get(eventType) ?? new Set<EventSubscriber>();
    existing.add(subscriber);
    this.subscribers.set(eventType, existing);

    return () => {
      existing.delete(subscriber);
      if (existing.size === 0) this.subscribers.delete(eventType);
    };
  }

  async emit<TPayload extends Record<string, unknown>>(
    input: CreateTokenEventInput<TPayload>,
  ): Promise<EmitEventResult> {
    return this.emitEvent(createTokenEvent(input));
  }

  async emitEvent(event: TokenEvent): Promise<EmitEventResult> {
    let persistence: PersistedEventResult = {
      id: null,
      eventKey: event.eventKey,
      inserted: false,
      duplicate: false,
    };

    let capturedError: Error | undefined;

    if (this.persistenceEnabled) {
      try {
        const payload = event.payload ?? {};
        const token = await tokenRepository.upsert({
          ...event.token,
          lifecycleStatus: lifecycleForEvent(event.eventType),
          creatorWallet: stringFromPayload(payload, 'creatorWallet', 'creator_wallet'),
          lastSeenAt: event.observedAt,
          migratedAt: event.eventType === 'DEX_MIGRATED' ? event.occurredAt : undefined,
          latestSnapshot: marketFromEvent(event),
          metadata: {
            latestEventType: event.eventType,
            latestEventSource: event.source,
          },
        });

        persistence = await eventRepository.insert(event, {
          tokenId: token.id ?? null,
          persistedEventKey: persistedKey(event),
        });
      } catch (error) {
        capturedError = error instanceof Error ? error : new Error(String(error));
        this.logger.error('[EventEngine] Persistence failed:', capturedError.message);
        if (this.throwOnPersistenceError) throw capturedError;
      }
    }

    const result: EmitEventResult = {
      event,
      persisted: persistence.inserted,
      duplicate: persistence.duplicate,
      eventId: persistence.id,
      ...(capturedError ? { error: capturedError } : {}),
    };

    await this.notifySubscribers(event, result);
    return result;
  }

  private async notifySubscribers(event: TokenEvent, result: EmitEventResult): Promise<void> {
    const subscribers = [
      ...(this.subscribers.get(event.eventType) ?? []),
      ...(this.subscribers.get('*') ?? []),
    ];

    for (const subscriber of subscribers) {
      try {
        await subscriber(event, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[EventEngine] Subscriber failed for ${event.eventType}: ${message}`);
      }
    }
  }
}

export const eventEngine = new EventEngine();
