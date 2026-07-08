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

function cleanNumber(value?: number | null) {
  return value != null && Number.isFinite(value) ? value : null;
}

async function hasExistingAlertCreated(token: string) {
  const { data, error } = await supabase
    .from('token_memory_events')
    .select('id')
    .eq('token', token)
    .eq('event_type', 'ALERT_CREATED')
    .limit(1);

  if (error) {
    console.log('hasExistingAlertCreated error:', {
      token,
      error: error.message,
    });
    return false;
  }

  return Boolean(data?.length);
}

export async function recordTokenMemoryEvent(input: TokenMemoryEventInput) {
  if (!input.token) return;

  const eventType = input.eventType ?? 'SNAPSHOT';

  if (eventType === 'ALERT_CREATED') {
    const exists = await hasExistingAlertCreated(input.token);

    if (exists) {
      console.log('token memory event skipped duplicate ALERT_CREATED:', {
        token: input.token,
      });
      return;
    }
  }

  const { error } = await supabase.from('token_memory_events').insert({
    token: input.token,
    chain: input.chain ?? 'solana',
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
    console.log('recordTokenMemoryEvent error:', {
      token: input.token,
      error: error.message,
    });
  }
}