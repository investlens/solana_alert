import type { ChainMarketSnapshot } from '../chains/shared/types.js';
import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
export type Readiness = { state: 'WATCH' | 'SETUP_FORMING'; market: ChainMarketSnapshot | null; reasons: string[]; at: number };
export function validReadinessMarket(market: ChainMarketSnapshot | null, token: string, now = Date.now()): market is ChainMarketSnapshot {
  return Boolean(market && market.chain === 'robinhood' && market.tokenAddress.toLowerCase() === token.toLowerCase()
    && /^0x(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(market.pairAddress ?? '') && Number.isFinite(market.timestamp)
    && now >= market.timestamp && now - market.timestamp <= 120_000
    && [market.priceUsd, market.liquidityUsd].every(v => Number.isFinite(v) && v > 0));
}
export function assessReadiness(market: ChainMarketSnapshot | null, token: string, now = Date.now()): Readiness {
  if (!validReadinessMarket(market, token, now)) return { state: 'WATCH', market: null, at: now,
    reasons: ['Fresh, comparable USD price and pool liquidity unavailable.'] };
  const reasons: string[] = [];
  if (!Number.isFinite(market.marketCapUsd) || market.marketCapUsd <= 0) reasons.push('Market cap is unverified; FDV does not replace it.');
  if (market.liquidityUsd < 6_000) reasons.push('Pool liquidity below $6K screening level.');
  if (!Number.isFinite(market.volume5mUsd) || market.volume5mUsd < 3_000) reasons.push('Five-minute activity below $3K screening level.');
  if (!market.trades5mReported || ![market.buys5m, market.sells5m].every(v => Number.isFinite(v) && v >= 0)
    || market.buys5m < 40 || market.sells5m === 0 || market.buys5m / market.sells5m < 1.4)
    reasons.push('Balanced, reported buy/sell activity does not meet screening levels.');
  if (!market.pairCreatedAt || now < market.pairCreatedAt || now - market.pairCreatedAt < 30 * 60_000)
    reasons.push('Pair age is unverified or below 30 minutes.');
  if (!Number.isFinite(market.priceChange1h) || market.priceChange1h! <= 0) reasons.push('Positive one-hour movement is unverified.');
  return { state: reasons.length ? 'WATCH' : 'SETUP_FORMING', market, at: now,
    reasons: reasons.length ? reasons.slice(0, 4) : ['Market activity meets screening levels; pullback, creator risk and execution still need assessment.'] };
}
const cache = new Map<string, Readiness>();
const pending = new Map<string, Promise<Readiness>>();
let requestTimes: number[] = [];
export async function getTradeReadiness(token: string): Promise<Readiness> {
  if (!/^0x[a-f0-9]{40}$/i.test(token)) throw new Error('Invalid Robinchain token');
  token = token.toLowerCase(); const now = Date.now();
  const cached = cache.get(token); if (cached && now - cached.at < 60_000) return cached;
  const running = pending.get(token); if (running) return running;
  requestTimes = requestTimes.filter(at => now - at < 60_000);
  if (pending.size >= 2 || requestTimes.length >= 10) throw new Error('Readiness checks busy; retry in one minute');
  requestTimes.push(now);
  const work = getRobinhoodMarketSnapshot(token, { priority: 'BACKGROUND', caller: 'trade-readiness', queueWaitTimeoutMs: 750,
    signal: AbortSignal.timeout(5_000) }).catch(() => null).then(market => {
      const result = assessReadiness(market, token);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(token, result); return result;
    }).finally(() => pending.delete(token));
  pending.set(token, work); return work;
}
