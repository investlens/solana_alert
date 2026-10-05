// Pool-specific evidence: seven completed UTC days, never missing days as zero.
export type VolumeBreakoutEvidence = { price: number; marketCap: number | null; fdv: number | null; liquidity: number; volume24h: number; move24h: number; move1h: number; dailyAverage: number; multiple: number; pairCreatedAt: number; at: number; dayStart: number };
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
  if (!price || !liquidity || !volume24h || move24h == null || move1h == null || (!marketCap && !fdv) || !Number.isFinite(pairCreatedAt)) return null;
  return { price, liquidity, volume24h, move24h, move1h, marketCap, fdv, pairCreatedAt, at };
}
export function qualifyVolumeBreakout(snapshot: NonNullable<ReturnType<typeof poolVolumeSnapshot>>, average: number, now = Date.now()): VolumeBreakoutEvidence | null {
  if (!Number.isFinite(average) || average < 1000 || now < snapshot.at || now - snapshot.at > 90_000
    || snapshot.volume24h < 10000 || snapshot.liquidity < 2000 || snapshot.move24h <= 0 || snapshot.volume24h / average < 2) return null;
  return { ...snapshot, dailyAverage: average, multiple: snapshot.volume24h / average, dayStart: Math.floor(now / 86400000) * 86400000 };
}

type Cached = { expires: number; average: number | null };
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
export async function readVolumeBreakoutResult(network: string, token: string, pool: string): Promise<VolumeBreakoutRead> {
  if (!['robinhood', 'arc', 'solana'].includes(network) || !token || !pool) return {evidence:null,reason:'INVALID_IDENTITY'};
  const key = `${network}:${pool}:${Math.floor(Date.now() / 86400000)}`;
  for (const [k, v] of history) if (v.expires <= Date.now()) history.delete(k);
  if(Date.now()<backoffUntil)return {evidence:null,reason:'PROVIDER_BACKOFF'};
  if (pending.has(key) || pending.size >= 1) return {evidence:null,reason:'CAPACITY_LIMITED'};
  pending.add(key);
  try {
    const base = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(pool)}`;
    const snapshot = poolVolumeSnapshot(await json(base), network, token, pool, Date.now());
    if (!snapshot)return {evidence:null,reason:'SNAPSHOT_UNAVAILABLE'};
    if(snapshot.volume24h < 10000 || snapshot.move24h <= 0 || snapshot.liquidity < 2000)return {evidence:null,reason:'CONDITION_WAIT'};
    let cached = history.get(key);
    if (!cached) {
      const boundary = Math.floor(Date.now() / 86400000) * 86400;
      const data = await json(`${base}/ohlcv/day?aggregate=1&limit=7&before_timestamp=${boundary - 1}&currency=usd&token=base&include_empty_intervals=false`);
      const average = completedWeekAverage(data?.data?.attributes?.ohlcv_list, Date.now(), snapshot.pairCreatedAt);
      if (history.size >= 100) history.delete(history.keys().next().value!);
      cached = { average, expires: Date.now() + (average == null ? 10 * 60000 : 3600000) };
      history.set(key, cached);
    }
    if(cached.average==null)return {evidence:null,reason:'INCOMPLETE_WEEK'};
    const evidence=qualifyVolumeBreakout(snapshot,cached.average);return {evidence,reason:evidence?'QUALIFIED':'CONDITION_WAIT'};
  } catch(error) { const message=error instanceof Error?error.message:'';return {evidence:null,reason:message==='history request budget'?'CAPACITY_LIMITED':Date.now()<backoffUntil?'PROVIDER_BACKOFF':'PROVIDER_UNAVAILABLE'}; }
  finally { pending.delete(key); }
}

export async function readVolumeBreakout(network:string,token:string,pool:string):Promise<VolumeBreakoutEvidence|null>{return (await readVolumeBreakoutResult(network,token,pool)).evidence;}
