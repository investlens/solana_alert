import { ARC_USDC_ADDRESS } from './config.js';
import type { ArcPoolLaunch } from './uniswap.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const QUOTES = new Set([
  ARC_USDC_ADDRESS.toLowerCase(),
  ZERO,
]);

export type ArcLaunchCandidate = {
  chain: 'arc';
  source: 'uniswap_v4';
  assetId: `0x${string}`;
  quoteAsset: `0x${string}`;
  poolId: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export function normalizeArcPoolCandidate(pool: ArcPoolLaunch): ArcLaunchCandidate | null {
  const c0 = pool.currency0.toLowerCase();
  const c1 = pool.currency1.toLowerCase();
  const c0Quote = QUOTES.has(c0);
  const c1Quote = QUOTES.has(c1);

  // AlphaOS Phase 1 only accepts a pool with exactly one known quote side.
  // This avoids guessing which token is the newly launched/risky asset.
  if (c0Quote === c1Quote) return null;

  return {
    chain: 'arc',
    source: 'uniswap_v4',
    assetId: (c0Quote ? pool.currency1 : pool.currency0) as `0x${string}`,
    quoteAsset: (c0Quote ? pool.currency0 : pool.currency1) as `0x${string}`,
    poolId: pool.poolId,
    transactionHash: pool.transactionHash,
    blockNumber: pool.blockNumber,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hooks,
  };
}
