import { supabase } from '../services/supabase.js';

type TokenMemoryInput = {
  token: string;
  symbol?: string | null;
  name?: string | null;
  chain?: string | null;
  creatorWallet?: string | null;

  marketCap?: number | null;
  liquidity?: number | null;
  price?: number | null;

  buys?: number | null;
  sells?: number | null;

  confidence?: number | null;
  riskLevel?: string | null;

  creatorScore?: number | null;
  holderScore?: number | null;
  authorityScore?: number | null;

  raw?: Record<string, unknown> | null;
};

function num(value?: number | null) {
  return value != null && Number.isFinite(value) ? value : null;
}

export async function upsertTokenMemory(input: TokenMemoryInput) {
  if (!input.token) return;

  const marketCap = num(input.marketCap);
  const liquidity = num(input.liquidity);
  const price = num(input.price);

  const { data: existing } = await supabase
    .from('token_memory')
    .select('token, peak_market_cap, highest_price')
    .eq('token', input.token)
    .maybeSingle();

  const previousPeak = Number(existing?.peak_market_cap ?? 0);
  const previousHighPrice = Number(existing?.highest_price ?? 0);

  const peakMarketCap =
    marketCap != null ? Math.max(previousPeak, marketCap) : previousPeak || null;

  const highestPrice =
    price != null ? Math.max(previousHighPrice, price) : previousHighPrice || null;

  const payload = {
    token: input.token,
    symbol: input.symbol ?? null,
    name: input.name ?? null,
    chain: input.chain ?? 'solana',
    creator_wallet: input.creatorWallet ?? null,

    last_updated: new Date().toISOString(),

    alert_market_cap: existing ? undefined : marketCap,
    alert_price: existing ? undefined : price,
    alert_liquidity: existing ? undefined : liquidity,
    alert_created_at: existing ? undefined : new Date().toISOString(),

    first_market_cap: existing ? undefined : marketCap,
    current_market_cap: marketCap,
    peak_market_cap: peakMarketCap,

    first_liquidity: existing ? undefined : liquidity,
    current_liquidity: liquidity,

    first_price: existing ? undefined : price,
    current_price: price,
    highest_price: highestPrice,

    buy_count: input.buys ?? 0,
    sell_count: input.sells ?? 0,

    confidence: input.confidence ?? null,
    risk_level: input.riskLevel ?? null,

    creator_score: input.creatorScore ?? null,
    holder_score: input.holderScore ?? null,
    authority_score: input.authorityScore ?? null,

    reached_50k: (peakMarketCap ?? 0) >= 50_000,
    reached_100k: (peakMarketCap ?? 0) >= 100_000,
    reached_250k: (peakMarketCap ?? 0) >= 250_000,
    reached_500k: (peakMarketCap ?? 0) >= 500_000,
    reached_1m: (peakMarketCap ?? 0) >= 1_000_000,

    raw: input.raw ?? null,
  };

  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );

  const { error } = await supabase
    .from('token_memory')
    .upsert(cleanPayload, { onConflict: 'token' });

  if (error) {
    console.log('upsertTokenMemory error:', {
      token: input.token,
      error: error.message,
    });
  }
}