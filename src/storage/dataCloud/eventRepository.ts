import type { TokenEvent } from '../../domain/event.js';
import { supabase } from '../../services/supabase.js';
import { DataCloudError, errorMessage } from './errors.js';

export interface PersistEventOptions {
  tokenId?: string | null;
  persistedEventKey?: string;
}

export interface PersistedEventResult {
  id: string | null;
  eventKey: string;
  inserted: boolean;
  duplicate: boolean;
}

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

export class EventRepository {
  async insert(event: TokenEvent, options: PersistEventOptions = {}): Promise<PersistedEventResult> {
    const payload = event.payload ?? {};
    const eventKey = options.persistedEventKey ?? event.eventKey;

    const row = {
      event_key: eventKey,
      chain: event.token.chain.toLowerCase(),
      token_id: options.tokenId ?? null,
      token_address: event.token.tokenAddress,
      pair_address: event.token.pairAddress ?? null,
      creator_wallet: stringFromPayload(payload, 'creatorWallet', 'creator_wallet'),
      wallet_address: stringFromPayload(payload, 'walletAddress', 'wallet_address', 'wallet'),
      event_type: event.eventType,
      source: event.source,
      source_version: event.engineVersion ?? null,
      severity: event.severity.toLowerCase(),
      occurred_at: event.occurredAt,
      price: numberFromPayload(payload, 'priceUsd', 'price', 'currentPrice'),
      market_cap: numberFromPayload(payload, 'marketCapUsd', 'marketCap', 'market_cap'),
      liquidity: numberFromPayload(payload, 'liquidityUsd', 'liquidity'),
      volume_5m: numberFromPayload(payload, 'volume5mUsd', 'volume5m', 'volume_5m'),
      buys_5m: numberFromPayload(payload, 'buys5m', 'buys_5m'),
      sells_5m: numberFromPayload(payload, 'sells5m', 'sells_5m'),
      score: numberFromPayload(payload, 'opportunityScore', 'score'),
      confidence: numberFromPayload(payload, 'confidenceScore', 'confidence'),
      risk_score: numberFromPayload(payload, 'riskScore', 'risk_score'),
      evidence: payload,
      metadata: {
        observedAt: event.observedAt,
        correlationId: event.correlationId ?? null,
        causationId: event.causationId ?? null,
        originalEventKey: event.eventKey,
      },
    };

    const { data, error } = await supabase
      .from('token_events')
      .insert(row)
      .select('id,event_key')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { id: null, eventKey, inserted: false, duplicate: true };
      }

      throw new DataCloudError('event.insert', errorMessage(error), error);
    }

    return {
      id: data?.id ?? null,
      eventKey: data?.event_key ?? eventKey,
      inserted: true,
      duplicate: false,
    };
  }
}

export const eventRepository = new EventRepository();
