import { supabase } from '../services/supabase.js';

type TokenMemoryEventInput = {
  token: string;
  chain?: string | null;
  eventType?: string | null;
  eventSource?: string | null;
  marketCap?: number | null;
  liquidity?: number | null;
  price?: number | null;
  buys?: number | null;
  sells?: number | null;
  alphaScore?: number | null;
  aiConfidence?: number | null;
  riskLevel?: string | null;
  creatorScore?: number | null;
  holderScore?: number | null;
  walletScore?: number | null;
  note?: string | null;
  raw?: Record<string, unknown> | null;
};

const NON_PERSISTED_EVENT_TYPES = new Set(['SNAPSHOT', 'OBSERVATION', 'HEARTBEAT']);
const recentEvents = new Map<string, number>();
const RECENT_EVENT_TTL_MS = 60_000;

function cleanNumber(value?: number | null) {
  return value != null && Number.isFinite(value) ? value : null;
}

function normalizeEventType(value?: string | null) {
  return String(value ?? 'SNAPSHOT').trim().toUpperCase();
}

function eventKey(chain: string, token: string, eventType: string) {
  return `${chain.toLowerCase()}:${token.toLowerCase()}:${eventType}`;
}

function recentlyRecorded(key: string, now = Date.now()) {
  const prior = recentEvents.get(key);
  return prior != null && now - prior < RECENT_EVENT_TTL_MS;
}

function markRecorded(key: string, now = Date.now()) {
  recentEvents.set(key, now);
  if (recentEvents.size > 5_000) {
    for (const [candidate, at] of recentEvents) {
      if (now - at >= RECENT_EVENT_TTL_MS) recentEvents.delete(candidate);
    }
  }
}

async function hasExistingAlertCreated(token: string, chain: string) {
  const { data, error } = await supabase
    .from('token_memory_events')
    .select('id')
    .eq('token', token)
    .eq('chain', chain)
    .eq('event_type', 'ALERT_CREATED')
    .limit(1);

  if (error) {
    console.log('hasExistingAlertCreated error:', { token, error: error.message });
    return false;
  }
  return Boolean(data?.length);
}

export async function recordTokenMemoryEvent(input: TokenMemoryEventInput) {
  if (!input.token) return;

  const eventType = normalizeEventType(input.eventType);
  const chain = String(input.chain ?? 'solana').toLowerCase();
  const token = input.token.trim();

  if (NON_PERSISTED_EVENT_TYPES.has(eventType)) return;
  const key = eventKey(chain, token, eventType);
  if (recentlyRecorded(key)) return;

  if (eventType === 'ALERT_CREATED' && await hasExistingAlertCreated(token, chain)) {
    markRecorded(key);
    return;
  }

  const { error } = await supabase.from('token_memory_events').insert({
    token,
    chain,
    event_type: eventType,
    event_source: input.eventSource ?? null,
    market_cap: cleanNumber(input.marketCap),
    liquidity: cleanNumber(input.liquidity),
    price: cleanNumber(input.price),
    buys: input.buys ?? null,
    sells: input.sells ?? null,
    alpha_score: input.alphaScore ?? null,
    ai_confidence: input.aiConfidence ?? null,
    risk_level: input.riskLevel ?? null,
    creator_score: input.creatorScore ?? null,
    holder_score: input.holderScore ?? null,
    wallet_score: input.walletScore ?? null,
    note: input.note ?? null,
    raw: input.raw ?? null,
  });

  if (error) {
    console.log('recordTokenMemoryEvent error:', { token, error: error.message });
    return;
  }
  markRecorded(key);
}