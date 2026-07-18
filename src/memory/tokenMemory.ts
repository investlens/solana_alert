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

type ExistingTokenMemory = {
  token: string;
  symbol?: string | null;
  name?: string | null;
  chain?: string | null;
  creator_wallet?: string | null;
  confidence?: number | null;

  peak_market_cap?: number | null;
  highest_price?: number | null;

  alert_market_cap?: number | null;
  alert_price?: number | null;
  alert_liquidity?: number | null;
  alert_created_at?: string | null;

  raw?: Record<string, unknown> | null;
};

function num(value?: number | null): number | null {
  return value != null && Number.isFinite(value)
    ? value
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }

  return {};
}

function isMainAlert(raw?: Record<string, unknown> | null) {
  return raw?.source === 'MAIN_ALERT';
}

function buildPreservedRaw(args: {
  existingRaw: unknown;
  incomingRaw?: Record<string, unknown> | null;
  shouldCreateAlertSnapshot: boolean;
}) {
  const existingRaw = asRecord(args.existingRaw);
  const incomingRaw = asRecord(args.incomingRaw);

  /*
   * Support older rows where raw was stored as one flat object.
   */
  const existingAlert =
    asRecord(existingRaw.alert);

  const existingLatest =
    asRecord(existingRaw.latest);

  const legacyLooksLikeAlert =
    existingRaw.source === 'MAIN_ALERT' &&
    Object.keys(existingAlert).length === 0;

  const preservedAlert =
    Object.keys(existingAlert).length > 0
      ? existingAlert
      : legacyLooksLikeAlert
        ? existingRaw
        : {};

  const alert =
    args.shouldCreateAlertSnapshot &&
    Object.keys(preservedAlert).length === 0
      ? incomingRaw
      : preservedAlert;

  return {
    alert:
      Object.keys(alert).length > 0
        ? alert
        : null,

    latest:
      Object.keys(incomingRaw).length > 0
        ? incomingRaw
        : existingLatest,

    lastSource:
      typeof incomingRaw.source === 'string'
        ? incomingRaw.source
        : existingRaw.lastSource ?? null,
  };
}

export async function hasTokenAlertCreated(
  token: string
): Promise<boolean> {
  if (!token) return false;

  const { data, error } = await supabase
    .from('token_memory_events')
    .select('token')
    .eq('token', token)
    .eq('event_type', 'ALERT_CREATED')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log('hasTokenAlertCreated error:', {
      token,
      error: error.message,
    });

    /*
     * Do not block alert processing when the lookup itself fails.
     */
    return false;
  }

  return Boolean(data);
}

export async function upsertTokenMemory(
  input: TokenMemoryInput
) {
  if (!input.token) return;

  const marketCap = num(input.marketCap);
  const liquidity = num(input.liquidity);
  const price = num(input.price);

  const { data, error: fetchError } = await supabase
    .from('token_memory')
    .select(`
      token,
      symbol,
      name,
      chain,
      creator_wallet,
      peak_market_cap,
      highest_price,
      alert_market_cap,
      alert_price,
      alert_liquidity,
      alert_created_at,
      confidence,
      raw
    `)
    .eq('token', input.token)
    .maybeSingle();

  if (fetchError) {
    console.log('upsertTokenMemory fetch error:', {
      token: input.token,
      error: fetchError.message,
    });
  }

  const existing =
    (data as ExistingTokenMemory | null) ?? null;

  const previousPeak = Number(
    existing?.peak_market_cap ?? 0
  );

  const previousHighPrice = Number(
    existing?.highest_price ?? 0
  );

  const peakMarketCap =
    marketCap != null
      ? Math.max(previousPeak, marketCap)
      : previousPeak || null;

  const highestPrice =
    price != null
      ? Math.max(previousHighPrice, price)
      : previousHighPrice || null;

  const incomingIsMainAlert = isMainAlert(input.raw);

  /*
   * Alert baseline must only be created by a genuine MAIN_ALERT.
   * Pump.fun discovery, wallet tracking, and memory refreshes must
   * not establish or replace the official alert baseline.
   */
  const shouldCreateAlertSnapshot =
    incomingIsMainAlert &&
    !existing?.alert_created_at;

  const now = new Date().toISOString();

  const payload: Record<string, unknown> = {
    token: input.token,

    symbol:
      input.symbol ??
      existing?.symbol ??
      null,

    name:
      input.name ??
      existing?.name ??
      null,

    chain:
      input.chain ??
      existing?.chain ??
      'solana',

    creator_wallet:
      input.creatorWallet ??
      existing?.creator_wallet ??
      null,

    last_updated: now,

    current_market_cap: marketCap,
    peak_market_cap: peakMarketCap,

    current_liquidity: liquidity,

    current_price: price,
    highest_price: highestPrice,

    buy_count: input.buys ?? 0,
    sell_count: input.sells ?? 0,

    confidence: shouldCreateAlertSnapshot
      ? input.confidence ?? null
      : existing?.confidence ?? input.confidence ?? null,
    risk_level: input.riskLevel ?? null,

    creator_score: input.creatorScore ?? null,
    holder_score: input.holderScore ?? null,
    authority_score: input.authorityScore ?? null,

    reached_50k: (peakMarketCap ?? 0) >= 50_000,
    reached_100k: (peakMarketCap ?? 0) >= 100_000,
    reached_250k: (peakMarketCap ?? 0) >= 250_000,
    reached_500k: (peakMarketCap ?? 0) >= 500_000,
    reached_1m: (peakMarketCap ?? 0) >= 1_000_000,

    raw: buildPreservedRaw({
      existingRaw: existing?.raw,
      incomingRaw: input.raw,
      shouldCreateAlertSnapshot,
    }),
  };

  /*
   * Preserve the first observation separately from the alert.
   */
  if (!existing) {
    payload.first_market_cap = marketCap;
    payload.first_liquidity = liquidity;
    payload.first_price = price;
    payload.first_seen = now;
  }

  /*
   * Create official alert values exactly once.
   */
  if (shouldCreateAlertSnapshot) {
    payload.alert_market_cap = marketCap;
    payload.alert_price = price;
    payload.alert_liquidity = liquidity;
    payload.alert_created_at = now;
  }

  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(
      ([, value]) => value !== undefined
    )
  );

  const { error } = await supabase
    .from('token_memory')
    .upsert(cleanPayload, {
      onConflict: 'token',
    });

  if (error) {
    console.log('upsertTokenMemory error:', {
      token: input.token,
      error: error.message,
    });
  }
}