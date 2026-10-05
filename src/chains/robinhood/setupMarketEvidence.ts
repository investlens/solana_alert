import { chooseBestRobinhoodPair, fetchRobinhoodPairs, robinhoodPairFetchedAt, type DexScreenerPair } from './market.js';
import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import { readPonsV2Curve } from './ponsNormalAlertFastLane.js';

export type SetupMarketEvidence = {
  price: number; depth: number; at: number;
  source: 'CURVE' | 'DEX'; pair: string;
  marketCap: number | null; fdv: number | null;
  volume5m?: number | null; volume24h?: number | null; buys5m?: number | null; sells5m?: number | null;
};
const nonnegative = (v: unknown): number | null => v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export function setupDexEvidence(pairs: DexScreenerPair[], token: string, at: number): SetupMarketEvidence | null {
  const pair = chooseBestRobinhoodPair(pairs.filter(p => p.chainId === 'robinhood'), token);
  const price = Number(pair?.priceUsd); const depth = Number(pair?.liquidity?.usd);
  if (!pair?.pairAddress || !/^0x[a-f0-9]{40}$/i.test(pair.pairAddress)
    || !Number.isFinite(price) || price <= 0 || !Number.isFinite(depth) || depth <= 0) return null;
  const positive = (v: unknown) => v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  return { price, depth, at, source: 'DEX', pair: pair.pairAddress,
    marketCap: positive(pair.marketCap), fdv: positive(pair.fdv),
    volume5m: nonnegative(pair.volume?.m5), volume24h: nonnegative(pair.volume?.h24),
    buys5m: nonnegative(pair.txns?.m5?.buys), sells5m: nonnegative(pair.txns?.m5?.sells) };
}
// At most one governed DEX fetch per observation after graduation. No discovery
// poller or DB writes, and no ETH/USD comparisons across the source transition.
export async function readSetupMarket(launch: PonsLaunch, source?: 'CURVE' | 'DEX'): Promise<SetupMarketEvidence | null> {
  if (source !== 'DEX') {
    const curve = await readPonsV2Curve(launch);
    // Migrated curves may have zero reserves and return null. A verified DEX
    // pair is still usable; missing curve data is never fabricated as zero.
    if (curve && !curve.graduated) {
      const price = Number(curve.quoteReserve) / Number(curve.tokenReserve);
      const depth = Number(curve.quoteReserve) / 1e18;
      if (![price, depth].every(n => Number.isFinite(n) && n > 0)) return null;
      return { price, depth, at: Date.now(), source: 'CURVE', pair: launch.curve_address!, marketCap: null, fdv: null };
    }
  }
  const pairs = await fetchRobinhoodPairs(launch.token_address, { priority: 'BACKGROUND', caller: 'pons_setup_watch', queueWaitTimeoutMs: 500 });
  const fetchedAt = robinhoodPairFetchedAt(pairs);
  return fetchedAt == null ? null : setupDexEvidence(pairs, launch.token_address, fetchedAt);
}
