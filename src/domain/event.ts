import type { TokenIdentity } from './token.js';

export const TOKEN_EVENT_TYPES = [
  'TOKEN_DISCOVERED',
  'TOKEN_UPDATED',
  'LIQUIDITY_ADDED',
  'LIQUIDITY_REMOVED',
  'DEX_MIGRATED',
  'WATCHLIST_ENTERED',
  'WATCHLIST_EXITED',
  'AI_DECISION_CREATED',
  'ALERT_GENERATED',
  'ALERT_SENT',
  'ALERT_FAILED',
  'SMART_WALLET_BUY',
  'SMART_WALLET_SELL',
  'CREATOR_IDENTIFIED',
  'CREATOR_PROFILE_UPDATED',
  'NEW_ATH',
  'MARKET_CAP_2X',
  'MARKET_CAP_5X',
  'MARKET_CAP_10X',
  'MAJOR_PULLBACK',
  'RISK_CHANGED',
  'TOKEN_DIED',
] as const;

export type TokenEventType = (typeof TOKEN_EVENT_TYPES)[number] | string;

export type EventSeverity = 'DEBUG' | 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';

export interface TokenEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id?: string;
  eventKey: string;
  eventType: TokenEventType;
  severity: EventSeverity;
  token: TokenIdentity;
  source: string;
  occurredAt: string;
  observedAt: string;
  payload: TPayload;
  correlationId?: string | null;
  causationId?: string | null;
  engineVersion?: string | null;
  deduplicationWindowSeconds?: number;
}

export interface CreateTokenEventInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventType: TokenEventType;
  token: TokenIdentity;
  source: string;
  payload?: TPayload;
  severity?: EventSeverity;
  occurredAt?: string;
  correlationId?: string | null;
  causationId?: string | null;
  engineVersion?: string | null;
  deduplicationKey?: string | null;
  deduplicationWindowSeconds?: number;
}

function normaliseKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-');
}

export function buildEventKey(
  input: Pick<CreateTokenEventInput, 'eventType' | 'token' | 'source'> & {
    deduplicationKey?: string | null;
  },
): string {
  const custom = input.deduplicationKey
    ? `:${normaliseKeyPart(input.deduplicationKey)}`
    : '';

  return [
    normaliseKeyPart(input.token.chain),
    normaliseKeyPart(input.token.tokenAddress),
    normaliseKeyPart(input.eventType),
    normaliseKeyPart(input.source),
  ].join(':') + custom;
}

export function createTokenEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
>(input: CreateTokenEventInput<TPayload>): TokenEvent<TPayload> {
  const now = new Date().toISOString();

  return {
    eventKey: buildEventKey(input),
    eventType: input.eventType,
    severity: input.severity ?? 'INFO',
    token: input.token,
    source: input.source,
    occurredAt: input.occurredAt ?? now,
    observedAt: now,
    payload: input.payload ?? ({} as TPayload),
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
    engineVersion: input.engineVersion ?? null,
    deduplicationWindowSeconds: input.deduplicationWindowSeconds ?? 0,
  };
}
