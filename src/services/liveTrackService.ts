import { chooseBestPair, fetchPairs } from './dexscreener.js';
import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
import { supabase } from './supabase.js';
import { editTelegramMessage, sendTelegramWithMessageId, type InlineButton } from './telegram.js';

export const LIVE_TRACK_DURATION_MS = 15 * 60_000;
export const LIVE_TRACK_FAST_PHASE_MS = 2 * 60_000;
export const LIVE_TRACK_FAST_INTERVAL_MS = 15_000;
export const LIVE_TRACK_NORMAL_INTERVAL_MS = 30_000;
const WORKER_TICK_MS = 5_000;
const MEANINGFUL_STATES = new Set([
  'MOMENTUM_ACCELERATING', 'ENTRY_CONFIRMING', 'BREAKOUT', 'RUNNER', 'MOMENTUM_WEAKENING',
  'DEV_SELL', 'MATERIAL_LIQUIDITY_DROP', 'TRACK_INVALIDATED',
]);

type NullableNumber = number | null;
export type LiveTrackSnapshot = {
  observedAt: string; source: string | null; name: string | null; symbol: string | null;
  price: NullableNumber; marketCap: NullableNumber; liquidity: NullableNumber; volume5m: NullableNumber;
  buys5m: NullableNumber; sells5m: NullableNumber; devHolding: NullableNumber; devBurn: NullableNumber;
  devSell: boolean | null; devTransfer: boolean | null; boostTotal: NullableNumber; dexPaid: boolean | null;
  intelligenceState: string | null; lifecycleState: string | null; chartUrl: string | null;
};

export type LiveTrackSession = {
  id: string; user_id: string; chain: 'solana' | 'robinhood'; token_address: string;
  opportunity_id: number | null; started_at: string; expires_at: string; status: string;
  telegram_chat_id: string; telegram_message_id: number | null; baseline: LiveTrackSnapshot;
  latest: LiveTrackSnapshot; peak: Record<string, unknown>; next_update_at: string; last_observed_at: string | null;
};

type OpportunityContext = { id: number; asset_id: string; chain: string | null; status: string | null;
  recommended_action: string | null; raw_data: Record<string, unknown> | null };
type TrackDependencies = {
  now: () => Date; market: (chain: string, token: string) => Promise<Partial<LiveTrackSnapshot> | null>;
  evidence: (chain: string, token: string, raw: Record<string, unknown> | null) => Promise<Partial<LiveTrackSnapshot>>;
  send: typeof sendTelegramWithMessageId; edit: typeof editTelegramMessage;
};

function finite(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
function positive(value: unknown): number | null { const n = finite(value); return n != null && n > 0 ? n : null; }
function bool(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function text(value: unknown): string | null {
  const result = typeof value === 'string' ? value.trim() : ''; return result && !/^unknown(?: token)?$/i.test(result) ? result : null;
}
function html(value: unknown): string { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function rawNumber(raw: Record<string, unknown> | null, ...keys: string[]): number | null {
  for (const key of keys) { const value = finite(raw?.[key]); if (value != null) return value; } return null;
}
function rawBool(raw: Record<string, unknown> | null, ...keys: string[]): boolean | null {
  for (const key of keys) { const value = bool(raw?.[key]); if (value != null) return value; } return null;
}

export function nextLiveTrackDelayMs(startedAt: string | number | Date, now: string | number | Date): number {
  return new Date(now).getTime() - new Date(startedAt).getTime() < LIVE_TRACK_FAST_PHASE_MS
    ? LIVE_TRACK_FAST_INTERVAL_MS : LIVE_TRACK_NORMAL_INTERVAL_MS;
}

async function marketSnapshot(chain: string, token: string): Promise<Partial<LiveTrackSnapshot> | null> {
  if (chain === 'robinhood') {
    const market = await getRobinhoodMarketSnapshot(token, {
      priority: 'NORMAL', caller: 'alpha_live_track', queueWaitTimeoutMs: 1_000,
    });
    if (!market) return null;
    return { source: market.source ?? 'DEXSCREENER', name: text(market.name), symbol: text(market.symbol),
      price: positive(market.priceUsd), marketCap: positive(market.marketCapUsd), liquidity: finite(market.liquidityUsd),
      volume5m: finite(market.volume5mUsd), buys5m: finite(market.buys5m), sells5m: finite(market.sells5m),
      chartUrl: market.chartUrl ?? null };
  }
  const pair = chooseBestPair(await fetchPairs(token), token);
  if (!pair) return null;
  return { source: 'DEXSCREENER', name: text(pair.baseToken?.name), symbol: text(pair.baseToken?.symbol),
    price: positive(pair.priceUsd), marketCap: positive(pair.marketCap), liquidity: finite(pair.liquidity?.usd),
    volume5m: finite(pair.volume?.m5), buys5m: finite(pair.txns?.m5?.buys), sells5m: finite(pair.txns?.m5?.sells),
    chartUrl: pair.url ?? null };
}

async function cachedEvidence(chain: string, token: string, raw: Record<string, unknown> | null): Promise<Partial<LiveTrackSnapshot>> {
  const [intelResult, eventResult] = await Promise.all([
    supabase.from('token_intelligence_cache').select('result,expires_at').eq('chain', chain)
      .ilike('token_address', token).gt('expires_at', new Date().toISOString()).maybeSingle(),
    supabase.from('alpha_alert_events').select('semantic_event_type,intelligence_state,boost_total,raw_snapshot')
      .eq('chain', chain).ilike('asset_id', token).order('alerted_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const intel = (intelResult.data?.result ?? {}) as any;
  const event = eventResult.data as any;
  const eventRaw = (event?.raw_snapshot ?? {}) as Record<string, unknown>;
  const developer = intel.developer ?? {};
  const security = intel.security ?? {};
  const semantic = text(event?.semantic_event_type);
  return {
    name: text(intel.name) ?? text(raw?.name), symbol: text(intel.symbol) ?? text(raw?.symbol),
    devHolding: finite(developer.holdingPct) ?? rawNumber(raw, 'devHoldingPercent'),
    devBurn: finite(developer.burnedPct) ?? finite(security.tokenBurnedPct) ?? rawNumber(raw, 'burnedPercent'),
    devSell: bool(developer.sold) ?? rawBool(raw, 'devSold', 'developerSold') ?? (semantic === 'DEV_SELL' ? true : null),
    devTransfer: developer.transferredPct != null ? Number(developer.transferredPct) > 0 : semantic === 'DEV_TRANSFER' ? true : null,
    boostTotal: finite(security.boostTotal) ?? finite(event?.boost_total) ?? rawNumber(eventRaw, 'boostTotal') ?? rawNumber(raw, 'boostTotal'),
    dexPaid: bool(security.dexPaid) ?? rawBool(raw, 'dexPaid') ?? (semantic === 'DEX_PAID' ? true : null),
    intelligenceState: text(event?.intelligence_state) ?? text(intel.alpha?.state) ?? text(raw?.intelligenceState),
    lifecycleState: text(raw?.lifecycleState) ?? text(raw?.lifecycle_state),
  };
}

const productionDependencies: TrackDependencies = { now: () => new Date(), market: marketSnapshot,
  evidence: cachedEvidence, send: sendTelegramWithMessageId, edit: editTelegramMessage };

export async function captureLiveTrackSnapshot(args: { chain: string; token: string;
  raw?: Record<string, unknown> | null }, dependencies: TrackDependencies = productionDependencies): Promise<LiveTrackSnapshot> {
  const observedAt = dependencies.now().toISOString();
  const [market, evidence] = await Promise.all([
    dependencies.market(args.chain, args.token).catch(() => null),
    dependencies.evidence(args.chain, args.token, args.raw ?? null).catch(() => ({} as Partial<LiveTrackSnapshot>)),
  ]);
  return { observedAt, source: market?.source ?? null, name: market?.name ?? evidence.name ?? text(args.raw?.name),
    symbol: market?.symbol ?? evidence.symbol ?? text(args.raw?.symbol), price: market?.price ?? null,
    marketCap: market?.marketCap ?? null, liquidity: market?.liquidity ?? null, volume5m: market?.volume5m ?? null,
    buys5m: market?.buys5m ?? null, sells5m: market?.sells5m ?? null, devHolding: evidence.devHolding ?? null,
    devBurn: evidence.devBurn ?? null, devSell: evidence.devSell ?? null, devTransfer: evidence.devTransfer ?? null,
    boostTotal: evidence.boostTotal ?? null, dexPaid: evidence.dexPaid ?? null,
    intelligenceState: evidence.intelligenceState ?? null, lifecycleState: evidence.lifecycleState ?? null,
    chartUrl: market?.chartUrl ?? text(args.raw?.chartUrl) };
}

function money(value: number | null): string { if (value == null) return 'Unavailable';
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`; if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`; }
function price(value: number | null): string { return value == null ? 'Unavailable' : value >= .01 ? `$${value.toFixed(6)}` : `$${value.toPrecision(6)}`; }
function pct(current: number | null, baseline: number | null): string { return current == null || baseline == null || baseline <= 0
  ? 'Unavailable' : `${current >= baseline ? '+' : ''}${((current / baseline - 1) * 100).toFixed(1)}%`; }
function knownBool(value: boolean | null, yes: string, no: string): string { return value == null ? 'Unknown' : value ? yes : no; }
function duration(startedAt: string, now: string): string { const seconds = Math.max(0, (Date.parse(now) - Date.parse(startedAt)) / 1000);
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`; }

export function renderLiveTrackMessage(session: Pick<LiveTrackSession, 'id' | 'chain' | 'token_address' | 'started_at' | 'baseline' | 'latest'>): string {
  const { baseline, latest } = session;
  const volumeAcceleration = baseline.volume5m != null && baseline.volume5m > 0 && latest.volume5m != null
    ? `${(latest.volume5m / baseline.volume5m).toFixed(2)}x vs Track` : 'Unavailable';
  const interpretation = latest.intelligenceState ?? latest.lifecycleState ?? 'Gathering verified observations';
  return ['👁 <b>ALPHAOS LIVE TRACK</b>', '',
    `<b>${html(latest.name ?? 'Token')}</b>${latest.symbol ? ` · $${html(latest.symbol)}` : ''}`,
    `<code>${html(session.token_address)}</code>`, '',
    `Price  <b>${price(latest.price)}</b>  (${pct(latest.price, baseline.price)})`,
    `Market Cap  <b>${money(latest.marketCap)}</b>  (${pct(latest.marketCap, baseline.marketCap)})`,
    `Liquidity  <b>${money(latest.liquidity)}</b>`, `5m volume  <b>${money(latest.volume5m)}</b>`,
    `Volume acceleration  <b>${volumeAcceleration}</b>`,
    `Buys / sells  <b>${latest.buys5m ?? 'Unavailable'} / ${latest.sells5m ?? 'Unavailable'}</b>`, '',
    `Dev holding  <b>${latest.devHolding == null ? 'Unknown' : `${latest.devHolding.toFixed(2)}%`}</b>`,
    `Dev burn  <b>${latest.devBurn == null ? 'Unknown' : `${latest.devBurn.toFixed(2)}%`}</b>`,
    `Dev sell  <b>${knownBool(latest.devSell, 'Detected', 'Not detected')}</b>`,
    `Boost total  <b>${latest.boostTotal ?? 'Unavailable'}</b>`,
    `DEX paid  <b>${knownBool(latest.dexPaid, 'Yes', 'No')}</b>`, '',
    `🧠 <b>AlphaOS</b> · ${html(interpretation.replace(/_/g, ' '))}`,
    `Tracking  <b>${duration(session.started_at, latest.observedAt)}</b>`,
    `Last update  <b>${html(new Date(latest.observedAt).toISOString().replace('T', ' ').slice(0, 19))} UTC</b>`,
  ].join('\n');
}

export function buildLiveTrackButtons(session: Pick<LiveTrackSession, 'id' | 'chain' | 'token_address' | 'latest'>): InlineButton[][] {
  const prefix = session.chain === 'robinhood' ? 'RH' : 'SOL';
  const tokenUrl = session.chain === 'robinhood'
    ? `https://robinhoodchain.blockscout.com/token/${session.token_address}`
    : `https://solscan.io/token/${session.token_address}`;
  return [
    [{ text: '📊 Chart', url: session.latest.chartUrl ?? 'https://dexscreener.com' }, { text: '🔎 Token', url: tokenUrl }],
    [{ text: '🔬 Full Intel', callback_data: `FI_${prefix}_${session.token_address}` }],
    [{ text: '📋 Copy CA', callback_data: `COPY_CA_${session.token_address}` }],
    [{ text: '⏹ Stop Track', callback_data: `LT_STOP_${session.id}` }, { text: '⏱ +15m', callback_data: `LT_EXT_${session.id}` }],
  ];
}

function peaks(previous: Record<string, unknown>, snapshot: LiveTrackSnapshot) {
  const result = { ...previous };
  for (const key of ['price', 'marketCap', 'liquidity', 'volume5m', 'boostTotal'] as const) {
    const current = snapshot[key]; const prior = finite(result[key]);
    if (current != null && (prior == null || current > prior)) result[key] = current;
  }
  return result;
}

async function insertObservation(session: LiveTrackSession, snapshot: LiveTrackSnapshot): Promise<void> {
  const { error } = await supabase.from('alpha_live_track_observations').insert({ session_id: session.id,
    observed_at: snapshot.observedAt, elapsed_seconds: Math.max(0, Math.round((Date.parse(snapshot.observedAt) - Date.parse(session.started_at)) / 1000)),
    snapshot, source_freshness: { market: snapshot.source, market_observed_at: snapshot.observedAt,
      intelligence: 'PERSISTED_CACHE_ONLY' } });
  if (error) throw error;
}

export function meaningfulLiveTrackTransitions(baseline: LiveTrackSnapshot, latest: LiveTrackSnapshot): string[] {
  const result: string[] = [];
  const state = latest.intelligenceState?.toUpperCase(); if (state && MEANINGFUL_STATES.has(state)) result.push(state);
  if (latest.devSell === true && baseline.devSell !== true) result.push('DEV_SELL');
  if (baseline.liquidity != null && baseline.liquidity > 0 && latest.liquidity != null && latest.liquidity <= baseline.liquidity * .75)
    result.push('MATERIAL_LIQUIDITY_DROP');
  if (baseline.price != null && baseline.price > 0 && latest.price != null) {
    const gain = latest.price / baseline.price - 1;
    for (const milestone of [20, 50, 100]) if (gain >= milestone / 100) result.push(`MILESTONE_${milestone}`);
  }
  return [...new Set(result)];
}

async function notifyTransitions(session: LiveTrackSession, snapshot: LiveTrackSnapshot,
  dependencies: TrackDependencies): Promise<void> {
  for (const transition of meaningfulLiveTrackTransitions(session.baseline, snapshot)) {
    const { data, error } = await supabase.from('alpha_live_track_transitions').insert({ session_id: session.id,
      transition_key: transition, transition_type: transition, snapshot }).select('id').maybeSingle();
    if (error) { if (String(error.code) === '23505') continue; throw error; }
    if (!data) continue;
    const messageId = await dependencies.send(session.telegram_chat_id,
      `👁 <b>LIVE TRACK UPDATE · ${html(transition.replace(/_/g, ' '))}</b>\n\n` +
      `<code>${html(session.token_address)}</code>\nPrice since Track: <b>${pct(snapshot.price, session.baseline.price)}</b>`);
    if (messageId != null) await supabase.from('alpha_live_track_transitions').update({ telegram_message_id: messageId }).eq('id', data.id);
  }
}

export async function startLiveTrack(args: { userId: string; chatId: string; opportunity: OpportunityContext },
  dependencies: TrackDependencies = productionDependencies): Promise<LiveTrackSession> {
  const chain = args.opportunity.chain === 'robinhood' ? 'robinhood' : 'solana';
  const now = dependencies.now();
  const baseline = await captureLiveTrackSnapshot({ chain, token: args.opportunity.asset_id,
    raw: args.opportunity.raw_data }, dependencies);
  baseline.lifecycleState ??= text(args.opportunity.recommended_action) ?? text(args.opportunity.status);
  if (baseline.price == null) throw new Error('Verified current price is unavailable; Track was not started.');
  const expiresAt = new Date(now.getTime() + LIVE_TRACK_DURATION_MS).toISOString();
  const row = { user_id: args.userId, chain, token_address: args.opportunity.asset_id,
    opportunity_id: args.opportunity.id, started_at: now.toISOString(), expires_at: expiresAt, status: 'ACTIVE',
    telegram_chat_id: args.chatId, baseline, latest: baseline, peak: peaks({}, baseline),
    next_update_at: new Date(now.getTime() + LIVE_TRACK_FAST_INTERVAL_MS).toISOString(), last_observed_at: baseline.observedAt };
  const existingResult = await supabase.from('alpha_live_track_sessions').select('id').eq('user_id', args.userId)
    .eq('chain', chain).ilike('token_address', args.opportunity.asset_id).eq('status', 'ACTIVE').maybeSingle();
  if (existingResult.error) throw existingResult.error;
  const mutation = existingResult.data
    ? supabase.from('alpha_live_track_sessions').update(row).eq('id', existingResult.data.id)
    : supabase.from('alpha_live_track_sessions').insert(row);
  const { data, error } = await mutation.select('*').single();
  if (error) throw error;
  const session = data as LiveTrackSession;
  await insertObservation(session, baseline);
  const messageId = await dependencies.send(args.chatId, renderLiveTrackMessage(session), buildLiveTrackButtons(session));
  if (messageId != null) {
    session.telegram_message_id = messageId;
    const update = await supabase.from('alpha_live_track_sessions').update({ telegram_message_id: messageId }).eq('id', session.id);
    if (update.error) throw update.error;
  }
  return session;
}

export async function updateLiveTrackSession(session: LiveTrackSession,
  dependencies: TrackDependencies = productionDependencies): Promise<void> {
  const now = dependencies.now();
  if (Date.parse(session.expires_at) <= now.getTime()) {
    await supabase.from('alpha_live_track_sessions').update({ status: 'EXPIRED', updated_at: now.toISOString() }).eq('id', session.id);
    return;
  }
  const snapshot = await captureLiveTrackSnapshot({ chain: session.chain, token: session.token_address }, dependencies);
  const latest = { ...session.latest, ...snapshot,
    devHolding: snapshot.devHolding ?? session.latest.devHolding, devBurn: snapshot.devBurn ?? session.latest.devBurn,
    devSell: snapshot.devSell ?? session.latest.devSell, devTransfer: snapshot.devTransfer ?? session.latest.devTransfer,
    boostTotal: snapshot.boostTotal ?? session.latest.boostTotal, dexPaid: snapshot.dexPaid ?? session.latest.dexPaid,
    intelligenceState: snapshot.intelligenceState ?? session.latest.intelligenceState,
    lifecycleState: snapshot.lifecycleState ?? session.latest.lifecycleState };
  const next = new Date(now.getTime() + nextLiveTrackDelayMs(session.started_at, now)).toISOString();
  await insertObservation(session, latest);
  const peak = peaks(session.peak, latest);
  const update = await supabase.from('alpha_live_track_sessions').update({ latest, peak, last_observed_at: latest.observedAt,
    next_update_at: next, updated_at: now.toISOString() }).eq('id', session.id).eq('status', 'ACTIVE');
  if (update.error) throw update.error;
  const current = { ...session, latest, peak, next_update_at: next };
  if (session.telegram_message_id != null) await dependencies.edit(session.telegram_chat_id,
    session.telegram_message_id, renderLiveTrackMessage(current), buildLiveTrackButtons(current));
  await notifyTransitions(current, latest, dependencies);
}

export async function stopLiveTrack(sessionId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('alpha_live_track_sessions').update({ status: 'STOPPED',
    updated_at: new Date().toISOString() }).eq('id', sessionId).eq('user_id', userId).eq('status', 'ACTIVE').select('id').maybeSingle();
  if (error) throw error; return Boolean(data);
}
export async function extendLiveTrack(sessionId: string, userId: string): Promise<boolean> {
  const { data: existing, error: readError } = await supabase.from('alpha_live_track_sessions').select('expires_at')
    .eq('id', sessionId).eq('user_id', userId).eq('status', 'ACTIVE').maybeSingle();
  if (readError) throw readError; if (!existing) return false;
  const expires_at = new Date(Math.max(Date.now(), Date.parse(existing.expires_at)) + LIVE_TRACK_DURATION_MS).toISOString();
  const { data, error } = await supabase.from('alpha_live_track_sessions').update({ expires_at,
    updated_at: new Date().toISOString() }).eq('id', sessionId).eq('user_id', userId).eq('status', 'ACTIVE').select('id').maybeSingle();
  if (error) throw error; return Boolean(data);
}

let workerStarted = false; let workerRunning = false;
export async function runLiveTrackCycle(dependencies: TrackDependencies = productionDependencies): Promise<void> {
  if (workerRunning) return; workerRunning = true;
  try {
    const now = dependencies.now().toISOString();
    await supabase.from('alpha_live_track_sessions').update({ status: 'EXPIRED', updated_at: now })
      .eq('status', 'ACTIVE').lte('expires_at', now);
    const { data, error } = await supabase.from('alpha_live_track_sessions').select('*').eq('status', 'ACTIVE')
      .lte('next_update_at', now).gt('expires_at', now).order('next_update_at').limit(20);
    if (error) throw error;
    for (const row of data ?? []) await updateLiveTrackSession(row as LiveTrackSession, dependencies).catch(error =>
      console.error('[LiveTrack] Session update failed:', { sessionId: row.id,
        reason: error instanceof Error ? error.message : String(error) }));
  } finally { workerRunning = false; }
}
export function startLiveTrackService(): ReturnType<typeof setInterval> | null {
  if (workerStarted) return null; workerStarted = true; void runLiveTrackCycle();
  const timer = setInterval(() => void runLiveTrackCycle(), WORKER_TICK_MS); timer.unref?.(); return timer;
}
