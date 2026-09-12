import { recordCreatorLaunch } from '../agents/creatorIntelligenceAgent.js';
import { upsertTokenMemory } from '../memory/tokenMemory.js';
import { saveCreatorLaunch, getProvenCreator } from './creatorIntelStore.js';

export type PumpfunTokenEvent = {
  mint: string;
  symbol?: string | null;
  name?: string | null;
  creator?: string | null;
  uri?: string | null;
  isMutable?: boolean | null;
  buyCount?: number | null;
  sellCount?: number | null;
  volumeUsd?: number | null;
  marketCapUsd?: number | null;
  progressPct?: number | null;
  launchScore?: number | null;
  buyVelocityScore?: number | null;
};

/**
 * Legacy polling compatibility entrypoint.
 *
 * Pump.fun launch ingestion is now handled by startPumpPortalCreatorFeed() in
 * startup.ts. Keeping this function as a no-op avoids breaking older callers
 * while ensuring Bitquery is no longer a production dependency.
 */
export async function pollPumpfunEarlyFeed(): Promise<PumpfunTokenEvent[]> {
  return [];
}

/**
 * Shared ingestion helper for any future Solana launch source (QuickNode,
 * Birdeye, RPC/webhook, etc.). PumpPortal currently supplies the live feed.
 */
export async function recordPumpfunLaunch(token: PumpfunTokenEvent): Promise<void> {
  if (!token.mint) return;

  await saveCreatorLaunch({
    creatorWallet: token.creator ?? null,
    token: token.mint,
    symbol: token.symbol ?? null,
    name: token.name ?? null,
    initialMarketCap: token.marketCapUsd ?? null,
  });

  await upsertTokenMemory({
    token: token.mint,
    symbol: token.symbol ?? null,
    name: token.name ?? null,
    chain: 'solana',
    creatorWallet: token.creator ?? null,
    marketCap: token.marketCapUsd ?? null,
    liquidity: null,
    price: null,
    buys: token.buyCount ?? null,
    sells: token.sellCount ?? null,
    confidence: token.launchScore ?? null,
    riskLevel: null,
    creatorScore: null,
    holderScore: null,
    authorityScore: null,
    raw: { source: 'PUMPFUN_LAUNCH', progressPct: token.progressPct ?? null, isMutable: token.isMutable ?? null },
  });

  await recordCreatorLaunch({
    creatorWallet: token.creator ?? null,
    token: token.mint,
    chain: 'solana',
    symbol: token.symbol ?? token.name ?? null,
    marketCap: token.marketCapUsd ?? null,
    sourceAgent: 'PumpFunLiveLaunch',
    rawData: token as unknown as Record<string, unknown>,
  });

  if (token.creator) {
    const proven = await getProvenCreator(token.creator);
    if (proven) {
      console.log('🚨 PROVEN CREATOR LAUNCH DETECTED:', {
        creator: token.creator,
        token: token.mint,
        symbol: token.symbol ?? null,
        bestToken: proven.best_token,
        bestMarketCap: proven.best_market_cap,
      });
    }
  }
}
