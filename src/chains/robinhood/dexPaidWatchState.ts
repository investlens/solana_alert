import type { RobinhoodDiscoveredToken } from './discovery/types.js';
export const DEX_PAID_PAYMENT_MAX_AGE_SECONDS = Math.max(120, Math.min(600,
  Number(process.env.DEX_PAID_MAX_PAYMENT_AGE_SECONDS ?? 600) || 600));
export const DEX_PAID_WATCH_TTL_MS = 60 * 60_000;
export type DexPaidCandidate = { token: RobinhoodDiscoveredToken; lastSeenAt: number; lastCheckedAt: number };
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
export function dexPaidWatchLimit(intervalMs: number, checks: number): number {
  // Reserve a minute for lookup/security latency; do not grow the request budget.
  return Math.max(1, Math.min(24, Math.floor((DEX_PAID_PAYMENT_MAX_AGE_SECONDS - 60) * 1000 / intervalMs) * checks));
}
export function recentDexPayment(timestamp: number | null, now = Date.now()): boolean {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return false;
  const at = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return at <= now + 30_000 && now - at <= DEX_PAID_PAYMENT_MAX_AGE_SECONDS * 1000;
}
export function restoreDexPaidWatch(value: unknown, now: number, limit: number): DexPaidCandidate[] {
  if (!value || typeof value !== 'object') return [];
  const data = value as {version?: unknown; candidates?: unknown};
  if (data.version !== 1 || !Array.isArray(data.candidates)) return [];
  const unique = new Map<string, DexPaidCandidate>();
  for (const entry of data.candidates.slice(0, 24)) {
    if (!entry || typeof entry !== 'object') continue;
    const {token, lastSeenAt, lastCheckedAt} = entry as DexPaidCandidate;
    if (!token || token.chain !== 'robinhood' || !address(token.tokenAddress) || !['PONS','DEXSCREENER'].includes(token.source)
      || !Number.isFinite(lastSeenAt) || lastSeenAt > now || now - lastSeenAt >= DEX_PAID_WATCH_TTL_MS
      || !Number.isFinite(lastCheckedAt) || lastCheckedAt < 0 || lastCheckedAt > now
      || !Number.isFinite(token.discoveredAt) || token.discoveredAt > now) continue;
    const minimal: RobinhoodDiscoveredToken = {chain:'robinhood', tokenAddress:token.tokenAddress.toLowerCase(),
      discoveredAt:token.discoveredAt, source:token.source, sourceType:token.source==='PONS'?'LAUNCHPAD':'INDEXER', sources:[],
      ...(address(token.pairAddress) ? {pairAddress:token.pairAddress} : {}),
      ...(typeof token.symbol === 'string' ? {symbol:token.symbol.slice(0,24)} : {}),
      ...(typeof token.name === 'string' ? {name:token.name.slice(0,64)} : {})};
    unique.set(minimal.tokenAddress, {token:minimal,lastSeenAt,lastCheckedAt});
  }
  return [...unique.values()].sort((a,b)=>b.lastSeenAt-a.lastSeenAt).slice(0,limit);
}
export function dexPaidFeedCandidates(value: unknown, now: number): RobinhoodDiscoveredToken[] {
  if(!Array.isArray(value))return [];
  const tokens=new Map<string,RobinhoodDiscoveredToken>();
  for(const row of value.slice(0,100)) {
    if(row?.chainId!=='robinhood'||!address(row.tokenAddress))continue;
    const tokenAddress=row.tokenAddress.toLowerCase();
    tokens.set(tokenAddress,{chain:'robinhood',tokenAddress,discoveredAt:now,source:'DEXSCREENER',sourceType:'INDEXER',sources:[]});
  }
  return [...tokens.values()].slice(0,24);
}
export function snapshotDexPaidWatch(candidates: Iterable<DexPaidCandidate>, now: number, limit: number) {
  // Round-trip validation also strips metadata, images and bulky discovery history.
  return {version:1, candidates:restoreDexPaidWatch({version:1,candidates:[...candidates]},now,limit)};
}

export function seedDexPaidWatch(value: unknown, now: number, limit: number, factories: string[]): DexPaidCandidate[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(factories.map(x=>x.toLowerCase()));
  const entries: DexPaidCandidate[] = [];
  for (const item of value.slice(0,500)) {
    const launch = item?.launch;
    const created = Date.parse(launch?.block_timestamp ?? '');
    if (!launch || launch.chain !== 'robinhood' || !address(launch.token_address)
      || !allowed.has(String(launch.factory_address ?? '').toLowerCase())
      || !Number.isFinite(created) || created > now || now-created >= DEX_PAID_WATCH_TTL_MS) continue;
    entries.push({token:{chain:'robinhood',tokenAddress:launch.token_address.toLowerCase(),discoveredAt:created,
      source:'PONS',sourceType:'LAUNCHPAD',sources:[]},
      lastSeenAt:created,lastCheckedAt:0});
  }
  return restoreDexPaidWatch({version:1,candidates:entries.sort((a,b)=>b.lastSeenAt-a.lastSeenAt).slice(0,24)},now,limit);
}

// Keep the same total/check budget, reserving one quarter for promotion feeds.
// PONS retains the other three quarters when both sources are busy; neither
// refresh can starve the other source or downgrade authoritative PONS lineage.
export function rememberDexPaidCandidate(candidates:Map<string,DexPaidCandidate>, token:RobinhoodDiscoveredToken, now:number, limit:number):boolean {
  const key=token.tokenAddress.toLowerCase(), previous=candidates.get(key);
  if(previous){
    const authoritative=previous.token.source==='PONS' && token.source!=='PONS' ? previous.token : token;
    candidates.set(key,{token:authoritative,lastSeenAt:now,lastCheckedAt:previous.lastCheckedAt});return true;
  }
  const ordered=[...candidates.entries()].sort((a,b)=>a[1].lastSeenAt-b[1].lastSeenAt);
  const promotions=ordered.filter(([,c])=>c.token.source!=='PONS');
  const launches=ordered.filter(([,c])=>c.token.source==='PONS');
  const promotionReserve=Math.max(1,Math.ceil(limit/4));
  if(candidates.size>=limit){
    const incomingPons=token.source==='PONS';
    const victim=incomingPons
      ? (promotions.length>promotionReserve ? promotions[0] : launches[0] ?? promotions[0])
      : (promotions.length<promotionReserve ? launches[0] ?? promotions[0] : promotions.find(([,c])=>c.lastCheckedAt>0));
    if(!victim)return false;
    candidates.delete(victim[0]);
  }
  candidates.set(key,{token,lastSeenAt:now,lastCheckedAt:0});return true;
}

// Three launch checks then one promotion check. New launch arrivals cannot
// perpetually outrank retained promotions with a nonzero lastCheckedAt.
export function selectDexPaidCandidates(candidates: Iterable<DexPaidCandidate>, checks:number, cursor:number) {
  const ordered=[...candidates].sort((a,b)=>a.lastCheckedAt-b.lastCheckedAt);
  const selected:DexPaidCandidate[]=[];
  for(let i=0;i<checks && selected.length<ordered.length;i++) {
    const promotion=(cursor++ % 4)===3;
    const available=ordered.filter(c=>!selected.includes(c));
    selected.push(available.find(c=>(c.token.source!=='PONS')===promotion) ?? available[0]);
  }
  return {selected,cursor:cursor%4};
}
