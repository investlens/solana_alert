import { runSharedAtomic } from './sharedJsonCache.js';
import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
import { validReadinessMarket } from './tradeReadiness.js';
import type { ChainMarketSnapshot } from '../chains/shared/types.js';

export type Monitor = { token: string; pair: string; symbol: string; price: number; liquidity: number;
  at: number; expires: number; checked: number; users: string[]; mask: number; notices: number };
const KEY = 'alphaos:personal-monitor:v1';
// One shared hash, ten token records maximum. Admission, selection, rate budget
// and warning transitions are atomic across restarts/replicas. No DB writes.
export const MONITOR_SCRIPT = `
local now=tonumber(ARGV[2]); local values=redis.call('HGETALL',KEYS[1]); local rows={}; local count=0; local recent=0
for i=1,#values,2 do
 local row=cjson.decode(values[i+1])
 if row.expires<=now then redis.call('HDEL',KEYS[1],values[i]) else
  rows[values[i]]=row; count=count+1
  if row.checked>now-60000 then recent=recent+1 end
 end
end
local action=ARGV[1]; local token=ARGV[3]; local user=ARGV[4]; local row=rows[token]
if action=='add' then
 local own=0
 for _,r in pairs(rows) do for _,u in ipairs(r.users) do if u==user then own=own+1 end end end
 if row then
  for _,u in ipairs(row.users) do if u==user then return cjson.encode({status='ACTIVE',row=row}) end end
  if own>=2 or #row.users>=10 then return cjson.encode({status='CAPACITY'}) end
  table.insert(row.users,user)
 else
  if count>=10 or own>=2 then return cjson.encode({status='CAPACITY'}) end
  row=cjson.decode(ARGV[5]); row.users={user}
 end
 redis.call('HSET',KEYS[1],token,cjson.encode(row)); redis.call('PEXPIRE',KEYS[1],3660000)
 return cjson.encode({status='ACTIVE',row=row})
elseif action=='stop' then
 if row then
  local kept={}; for _,u in ipairs(row.users) do if u~=user then table.insert(kept,u) end end
  row.users=kept
  if #kept==0 then redis.call('HDEL',KEYS[1],token) else redis.call('HSET',KEYS[1],token,cjson.encode(row)) end
 end
 return cjson.encode({status='STOPPED'})
elseif action=='list' then
 local own={}; for _,r in pairs(rows) do for _,u in ipairs(r.users) do if u==user then table.insert(own,r) end end end
 return cjson.encode({status='LIST',rows=own})
elseif action=='next' then
 if recent>=5 then return cjson.encode({status='IDLE'}) end
 local chosen=nil
 for _,r in pairs(rows) do if r.checked<=now-120000 and (not chosen or r.checked<chosen.checked) then chosen=r end end
 if not chosen then return cjson.encode({status='IDLE'}) end
 if not redis.call('SET',KEYS[2],chosen.token..':'..now,'NX','PX',10000) then return cjson.encode({status='IDLE'}) end
 chosen.checked=now; redis.call('HSET',KEYS[1],chosen.token,cjson.encode(chosen))
 return cjson.encode({status='CHECK',row=chosen})
elseif action=='finish' then
 if redis.call('GET',KEYS[2])==token..':'..ARGV[7] then redis.call('DEL',KEYS[2]) end
 if not row or row.at~=tonumber(ARGV[6]) or row.checked~=tonumber(ARGV[7]) then return cjson.encode({status='EXPIRED'}) end
 local mask=tonumber(ARGV[5]); local new=bit.band(mask,bit.bnot(row.mask)); row.mask=mask
 local notify=new~=0 and row.notices<3
 if notify then row.notices=row.notices+1 end
 redis.call('HSET',KEYS[1],token,cjson.encode(row))
 return cjson.encode({status=notify and 'NOTIFY' or 'SILENT',row=row})
end
return cjson.encode({status='IDLE'})`;

type StoreResult = { status: string; row?: Monitor; rows?: Monitor[] };
async function store(action: string, token = '', user = '', data = '', at = '', checked = ''): Promise<StoreResult> {
  const raw = await runSharedAtomic(MONITOR_SCRIPT, [KEY, KEY + ':lease'], [action, String(Date.now()), token, user, data, at, checked]);
  if (typeof raw !== 'string') throw new Error('Monitoring store unavailable');
  return JSON.parse(raw) as StoreResult;
}
export async function startDeteriorationMonitor(user: string, market: ChainMarketSnapshot): Promise<StoreResult> {
  if (!/^\d+$/.test(user) || !validReadinessMarket(market, market.tokenAddress)) throw new Error('Fresh indexed Robinchain market required');
  const now = Date.now(); const token = market.tokenAddress.toLowerCase();
  const row: Monitor = { token, pair: market.pairAddress!.toLowerCase(), symbol: market.symbol.slice(0, 24), price: market.priceUsd,
    liquidity: market.liquidityUsd, at: now, expires: now + 60 * 60_000, checked: now, users: [], mask: 0, notices: 0 };
  return store('add', token, user, JSON.stringify(row));
}
export async function stopDeteriorationMonitor(user: string, token: string) { return store('stop', token.toLowerCase(), user); }
export async function personalMonitors(user: string) { return (await store('list', '', user)).rows ?? []; }
export function deteriorationMask(row: Monitor, market: ChainMarketSnapshot | null, now = Date.now()): number {
  if (!validReadinessMarket(market, row.token, now)) return (row.mask & 3) | 4;
  if (market.pairAddress!.toLowerCase() !== row.pair) return (row.mask & 3) | 8;
  const price = (market.priceUsd / row.price - 1) * 100;
  const liquidity = (market.liquidityUsd / row.liquidity - 1) * 100;
  // Separate trigger/recovery levels stop threshold flicker from spamming users.
  return (price <= -15 || ((row.mask & 1) !== 0 && price < -10) ? 1 : 0)
    | (liquidity <= -20 || ((row.mask & 2) !== 0 && liquidity < -10) ? 2 : 0);
}
let timer: ReturnType<typeof setInterval> | null = null; let running = false;
let pauseUntil = 0;
export function startDeteriorationWorker(notify: (user: string, row: Monitor, market: ChainMarketSnapshot | null, mask: number) => Promise<void>) {
  if (timer || !process.env.REDIS_URL) return;
  console.log('[DeteriorationMonitor] READY chain=robinhood maxTokens=10 maxChecksPerMinute=5 lifetimeMin=60 dbWrites=0');
  const tick = async () => {
    if (running || Date.now() < pauseUntil) return;
    running = true;
    try {
      const next = await store('next'); if (!next.row) return;
      const row = next.row;
      const market = await getRobinhoodMarketSnapshot(row.token, { priority: 'BACKGROUND', caller: 'personal-monitor',
        queueWaitTimeoutMs: 750, signal: AbortSignal.timeout(5_000) }).catch(() => null);
      const mask = deteriorationMask(row, market);
      const transition = await store('finish', row.token, '', String(mask), String(row.at), String(row.checked));
      if (transition.status !== 'NOTIFY' || !transition.row) return;
      // Reserve transition before sending: ambiguous responses are never replayed.
      for (const user of transition.row.users) await notify(user, transition.row, market, mask).catch(() => {});
      console.log('[DeteriorationMonitor] TRANSITION', { token: row.token, mask, subscribers: transition.row.users.length });
    } catch {
      pauseUntil = Date.now() + 60_000;
      console.warn('[DeteriorationMonitor] Store unavailable; monitoring paused for 60s');
    } finally { running = false; }
  };
  void store('list').then(() => console.log('[DeteriorationMonitor] STORE_READY atomicScript=true dbWrites=0'))
    .catch(() => console.warn('[DeteriorationMonitor] Store unavailable; monitoring remains fail-closed'));
  timer = setInterval(() => { void tick(); }, 15_000); timer.unref();
}
