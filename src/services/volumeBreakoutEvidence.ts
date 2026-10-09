import type { ChainMarketSnapshot } from '../chains/shared/types.js';
// Pool-specific evidence: one completed signal day and seven preceding days; no overlap or synthetic zeros.
export type VolumeBreakoutEvidence = { price: number; marketCap: number | null; fdv: number | null; liquidity: number; volume24h: number | null; move24h: number | null; move1h: number | null; marketSource?: string; dailyAverage: number; multiple: number; pairCreatedAt: number; at: number; dayStart: number; signalMove: number; signalVolume: number };
const DAY = 86400;
const positive = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function completedWeekAverage(rows: unknown, now: number, createdAt: number): number | null {
  const boundary = Math.floor(now / 1000 / DAY) * DAY;
  if (!Number.isFinite(createdAt) || createdAt > (boundary - 7 * DAY) * 1000 || !Array.isArray(rows)) return null;
  const days = new Map<number, number>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 6) return null;
    const [at, open, high, low, close, volume] = row;
    if (![at, open, high, low, close, volume].every(x => typeof x === 'number' && Number.isFinite(x)) || volume < 0 || at % DAY !== 0
      || open <= 0 || low <= 0 || close <= 0 || high < Math.max(open, close) || low > Math.min(open, close)) return null;
    if (at >= boundary || at < boundary - 7 * DAY) continue;
    if (days.has(at)) return null;
    days.set(at, volume);
  }
  if (days.size !== 7) return null;
  const average = [...days.values()].reduce((a, b) => a + b, 0) / 7;
  return average >= 1000 ? average : null;
}
export type CompletedVolumeWindow = { dailyAverage: number; signalVolume: number; signalMove: number; dayStart: number };
export function completedVolumeWindow(rows: unknown, now: number, createdAt: number): CompletedVolumeWindow | null {
  const boundary = Math.floor(now / 1000 / DAY) * DAY;
  if (!Array.isArray(rows) || !Number.isFinite(createdAt) || createdAt > (boundary - 8 * DAY) * 1000) return null;
  const signalRows = rows.filter(row => Array.isArray(row) && row[0] === boundary - DAY);
  if (signalRows.length !== 1) return null;
  // Validate the signal candle with the same strict OHLCV checks as the baseline.
  const baseline = completedWeekAverage(rows, now - DAY * 1000, createdAt);
  const signal = signalRows[0];
  const [at, open, high, low, close, volume] = signal;
  if (signal.length !== 6 || ![at, open, high, low, close, volume].every(x => typeof x === 'number' && Number.isFinite(x))
    || volume < 0 || open <= 0 || close <= 0 || low <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || baseline == null) return null;
  return { dailyAverage: baseline, signalVolume: volume, signalMove: (close / open - 1) * 100, dayStart: at * 1000 };
}
export function poolVolumeSnapshot(payload: any, network: string, token: string, pool: string, at: number) {
  const d = payload?.data, a = d?.attributes;
  if (!a || d.id?.toLowerCase() !== `${network}_${pool}`.toLowerCase()
    || a.address?.toLowerCase() !== pool.toLowerCase()
    || d.relationships?.base_token?.data?.id?.toLowerCase() !== `${network}_${token}`.toLowerCase()) return null;
  // Numeric strings are documented for prices/valuation; null/empty never become zero.
  const num = (v: unknown) => typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  const price = positive(num(a.base_token_price_usd)), liquidity = positive(num(a.reserve_in_usd));
  const volume24h = positive(num(a.volume_usd?.h24));
  const move24h = numeric(num(a.price_change_percentage?.h24)), move1h = numeric(num(a.price_change_percentage?.h1));
  const marketCap = positive(num(a.market_cap_usd)), fdv = positive(num(a.fdv_usd));
  const pairCreatedAt = Date.parse(a.pool_created_at ?? '');
  if (!price || !liquidity || (!marketCap && !fdv) || !Number.isFinite(pairCreatedAt)) return null;
  return { price, liquidity, volume24h, move24h, move1h, marketCap, fdv, pairCreatedAt, at };
}
// Reuse only a fresh, exact-pair snapshot already validated by the chain scanner.
// This avoids a second market request; GeckoTerminal still supplies all eight
// completed daily candles. Unknown optional movements remain null, never zero.
export function scannerVolumeSnapshot(m: ChainMarketSnapshot, network: string, token: string, pool: string, now = Date.now()) {
  const at = m.timestamp;
  if (m.chain !== network || m.tokenAddress.toLowerCase() !== token.toLowerCase()
    || m.pairAddress?.toLowerCase() !== pool.toLowerCase() || !/^0x[a-f0-9]{40}$/i.test(pool)
    || !Number.isFinite(at) || now < at || now - at > 90_000
    || !positive(m.priceUsd) || !positive(m.liquidityUsd) || !Number.isFinite(m.pairCreatedAt)
    || (!positive(m.marketCapUsd) && !positive(m.fdvUsd))) return null;
  return { price: m.priceUsd, liquidity: m.liquidityUsd,
    volume24h: positive(m.volume24hUsd), move24h: null, move1h: numeric(m.priceChange1h),
    marketCap: positive(m.marketCapUsd), fdv: positive(m.fdvUsd), pairCreatedAt: m.pairCreatedAt!, at,
    marketSource: 'DEXScreener' };
}
export function qualifyVolumeBreakout(snapshot: NonNullable<ReturnType<typeof poolVolumeSnapshot>>, window: CompletedVolumeWindow, now = Date.now()): VolumeBreakoutEvidence | null {
  if (!Number.isFinite(window.dailyAverage) || window.dailyAverage < 1000 || now < snapshot.at || now - snapshot.at > 90_000
    || window.dayStart !== (Math.floor(now / 86400000) - 1) * 86400000
    || window.signalVolume < 10000 || snapshot.liquidity < 2000 || window.signalMove <= 0 || window.signalVolume / window.dailyAverage < 2) return null;
  return { ...snapshot, ...window, multiple: window.signalVolume / window.dailyAverage };
}

type Cached = { expires: number; window: CompletedVolumeWindow | null };
const history = new Map<string, Cached>();
const pending = new Set<string>();
let minute = 0, requests = 0, backoffUntil = 0;
async function json(url: string): Promise<any> {
  const now = Date.now();
  if (now < backoffUntil) throw new Error('provider backoff');
  if (Math.floor(now / 60000) !== minute) { minute = Math.floor(now / 60000); requests = 0; }
  if (requests >= 6) throw new Error('history request budget');
  requests++;
  const response = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
  if (response.status === 429 || response.status >= 500) backoffUntil = Date.now() + 5 * 60000;
  if (!response.ok) throw new Error(`history HTTP ${response.status}`);
  return response.json();
}
export type VolumeBreakoutRead = {evidence:VolumeBreakoutEvidence|null;reason:'QUALIFIED'|'CONDITION_WAIT'|'INVALID_IDENTITY'|'CAPACITY_LIMITED'|'PROVIDER_BACKOFF'|'SNAPSHOT_UNAVAILABLE'|'INCOMPLETE_WEEK'|'PROVIDER_UNAVAILABLE'};
export async function readVolumeBreakoutResult(network: string, token: string, pool: string, market?: ChainMarketSnapshot): Promise<VolumeBreakoutRead> {
  if (!['robinhood', 'arc', 'solana'].includes(network) || !token || !pool) return {evidence:null,reason:'INVALID_IDENTITY'};
  const key = `${network}:${token}:${pool}:${Math.floor(Date.now() / 86400000)}`;
  for (const [k, v] of history) if (v.expires <= Date.now()) history.delete(k);
  if(Date.now()<backoffUntil)return {evidence:null,reason:'PROVIDER_BACKOFF'};
  if (pending.has(key) || pending.size >= 1) return {evidence:null,reason:'CAPACITY_LIMITED'};
  pending.add(key);
  try {
    const base = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(pool)}`;
    const snapshot = (market && scannerVolumeSnapshot(market, network, token, pool))
      || poolVolumeSnapshot(await json(base), network, token, pool, Date.now());
    if (!snapshot)return {evidence:null,reason:'SNAPSHOT_UNAVAILABLE'};
    if(snapshot.liquidity < 2000)return {evidence:null,reason:'CONDITION_WAIT'};
    let cached = history.get(key);
    if (!cached) {
      const boundary = Math.floor(Date.now() / 86400000) * 86400;
      const data = await json(`${base}/ohlcv/day?aggregate=1&limit=8&before_timestamp=${boundary - 1}&currency=usd&token=base&include_empty_intervals=false`);
      const window = completedVolumeWindow(data?.data?.attributes?.ohlcv_list, Date.now(), snapshot.pairCreatedAt);
      if (history.size >= 100) history.delete(history.keys().next().value!);
      cached = { window, expires: window == null ? Date.now() + 10 * 60000 : (boundary + DAY) * 1000 };
      history.set(key, cached);
    }
    if(cached.window==null)return {evidence:null,reason:'INCOMPLETE_WEEK'};
    const evidence=qualifyVolumeBreakout(snapshot,cached.window);return {evidence,reason:evidence?'QUALIFIED':'CONDITION_WAIT'};
  } catch(error) { const message=error instanceof Error?error.message:'';return {evidence:null,reason:message==='history request budget'?'CAPACITY_LIMITED':Date.now()<backoffUntil?'PROVIDER_BACKOFF':'PROVIDER_UNAVAILABLE'}; }
  finally { pending.delete(key); }
}

export async function readVolumeBreakout(network:string,token:string,pool:string):Promise<VolumeBreakoutEvidence|null>{return (await readVolumeBreakoutResult(network,token,pool)).evidence;}
