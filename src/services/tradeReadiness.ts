import type { ChainMarketSnapshot } from '../chains/shared/types.js';
import { cachedRobinhoodOwnership } from './alertOwnershipService.js';
import { capturedOwnershipEvidence } from './recoveryAlertAudit.js';
import type { OwnershipDisclosure } from '../ui/ownershipDisclosure.js';
import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
export type ReadinessCheck = { label: string; state: 'MET' | 'BELOW' | 'UNVERIFIED'; target: string; reason: string };
export type Readiness = { state: 'WATCH' | 'SETUP_FORMING'; market: ChainMarketSnapshot | null; reasons: string[]; at: number;
  checks?: ReadinessCheck[]; ownership?: OwnershipDisclosure };
export function readinessChecks(m: ChainMarketSnapshot, now: number): ReadinessCheck[] {
 const check = (label: string, verified: boolean, met: boolean, target: string, reason: string): ReadinessCheck =>
  ({label,state:!verified?'UNVERIFIED':met?'MET':'BELOW',target,reason});
 const trades = m.trades5mReported === true && [m.buys5m,m.sells5m].every(v=>Number.isFinite(v)&&v>=0);
 const age = m.pairCreatedAt != null && Number.isFinite(m.pairCreatedAt) && m.pairCreatedAt > 0 && now >= m.pairCreatedAt;
 return [
  check('Market cap',Number.isFinite(m.marketCapUsd)&&m.marketCapUsd>0,true,'MC reported', 'Market cap is unverified; FDV does not replace it.'),
  check('Liquidity',Number.isFinite(m.liquidityUsd)&&m.liquidityUsd>0,m.liquidityUsd>=6000,'≥ $6K','Pool liquidity below $6K screening level.'),
  check('5m activity',m.volume5mReported===true&&Number.isFinite(m.volume5mUsd)&&m.volume5mUsd>=0,m.volume5mUsd>=3000,'≥ $3K','Five-minute activity is unverified or below $3K screening level.'),
  check('Trade flow',trades,m.buys5m>=40&&m.sells5m>0&&m.buys5m/m.sells5m>=1.4,'≥ 40 buys · B/S ≥ 1.4 · sells reported','Balanced, reported buy/sell activity does not meet screening levels.'),
  check('Pair age',age,age&&now-m.pairCreatedAt!>=30*60000,'≥ 30m','Pair age is unverified or below 30 minutes.'),
  check('1h movement',Number.isFinite(m.priceChange1h),m.priceChange1h!>0,'> 0%','Positive one-hour movement is unverified or below screening level.'),
 ];
}
export function refreshReadinessEvidence(result: Readiness, token: string, now = Date.now()): Readiness {
 const refreshed = assessReadiness(result.market,token,now);
 const source = result.ownership;
 if (!source || !refreshed.market) return refreshed;
 const dev = capturedOwnershipEvidence(source,now);
 const top = source.top10Coverage !== 'UNAVAILABLE' && source.top10Percent != null && Number.isFinite(source.top10Percent) && source.top10Percent >= 0 && source.top10Percent <= 100
  && source.top10ObservedAt != null && now >= source.top10ObservedAt && now-source.top10ObservedAt<=60_000;
 return {...refreshed,ownership:{devPercent:dev?.percent??null,creator:dev?.creator,devObservedAt:dev?source.devObservedAt:undefined,
  devBlock:dev?.block,top10Percent:top?source.top10Percent:null,top10Coverage:top?source.top10Coverage:'UNAVAILABLE',top10ObservedAt:top?source.top10ObservedAt:undefined}};
}
export function validReadinessMarket(market: ChainMarketSnapshot | null, token: string, now = Date.now()): market is ChainMarketSnapshot {
  return Boolean(market && market.chain === 'robinhood' && market.tokenAddress.toLowerCase() === token.toLowerCase()
    && /^0x(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(market.pairAddress ?? '') && Number.isFinite(market.timestamp)
    && now >= market.timestamp && now - market.timestamp <= 120_000
    && [market.priceUsd, market.liquidityUsd].every(v => Number.isFinite(v) && v > 0));
}
export function assessReadiness(market: ChainMarketSnapshot | null, token: string, now = Date.now()): Readiness {
  if (!validReadinessMarket(market, token, now)) return { state: 'WATCH', market: null, at: now,
    reasons: ['Fresh, comparable USD price and pool liquidity unavailable.'] };
  const checks = readinessChecks(market,now);
  const reasons = checks.filter(c=>c.state!=='MET').map(c=>c.reason);
  return { state: reasons.length ? 'WATCH' : 'SETUP_FORMING', market, at: now, checks,
    reasons: reasons.length ? reasons : ['Market activity meets screening levels; pullback, creator risk and execution still need assessment.'] };
}
const cache = new Map<string, Readiness>();
const pending = new Map<string, Promise<Readiness>>();
let requestTimes: number[] = [];
export async function getTradeReadiness(token: string): Promise<Readiness> {
  if (!/^0x[a-f0-9]{40}$/i.test(token)) throw new Error('Invalid Robinchain token');
  token = token.toLowerCase(); const now = Date.now();
  const cached = cache.get(token); if (cached && now - cached.at < 60_000) return refreshReadinessEvidence(cached,token,now);
  const running = pending.get(token); if (running) return running;
  requestTimes = requestTimes.filter(at => now - at < 60_000);
  if (pending.size >= 2 || requestTimes.length >= 10) throw new Error('Readiness checks busy; retry in one minute');
  requestTimes.push(now);
  const work = getRobinhoodMarketSnapshot(token, { priority: 'BACKGROUND', caller: 'trade-readiness', queueWaitTimeoutMs: 750,
    signal: AbortSignal.timeout(5_000) }).catch(() => null).then(market => {
      const assessed = assessReadiness(market, token);
      const result = refreshReadinessEvidence({...assessed,ownership:cachedRobinhoodOwnership(token,null,market?.pairAddress)},token,assessed.at);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(token, result); return result;
    }).finally(() => pending.delete(token));
  pending.set(token, work); return work;
}
