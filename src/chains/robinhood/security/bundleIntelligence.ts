import { getAddress, type Address } from 'viem';
import { getPonsLaunchState } from '../ponsLaunchState.js';
import { getRobinhoodTokenMetadata } from '../tokenMetadata.js';
import { PONS_CONTRACTS } from '../ponsContracts.js';
import { scanRobinhoodDevMovement, type RobinhoodDevMovementResult } from './devMovementScanner.js';

const BLOCKSCOUT_BASE = 'https://robinhoodchain.blockscout.com';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead';

type HolderAddressInfo = { hash?: string; is_contract?: boolean };
type HolderRow = {
  value?: string;
  address_hash?: HolderAddressInfo;
  address?: HolderAddressInfo;
};
type HolderResponse = { items?: HolderRow[] };

type HolderShare = {
  wallet: string;
  sharePct: number;
  value: bigint;
};

export type RobinhoodBundleIntelligenceResult = {
  tokenAddress: Address;
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  evidenceAvailable: boolean;
  reasons: string[];
  connectedWallets: string[];
  metrics: {
    devSpreadDestinationCount: number;
    devMovedPercentOfSupply: number | null;
    devDestinationsStillTopHolders: number;
    connectedCurrentSupplyPct: number;
    similarLargeWalletCount: number;
    similarLargeWalletCombinedPct: number;
    sampledHolderCount: number;
  };
  scannedAt: number;
};

function normalized(value: string | null | undefined) {
  return String(value ?? '').toLowerCase();
}

function percentage(amount: bigint, total: bigint) {
  if (total <= 0n) return 0;
  return Number((amount * 1_000_000n) / total) / 10_000;
}

function unknown(tokenAddress: Address, reason: string): RobinhoodBundleIntelligenceResult {
  return {
    tokenAddress,
    score: 100,
    level: 'UNKNOWN',
    evidenceAvailable: false,
    reasons: [reason],
    connectedWallets: [],
    metrics: {
      devSpreadDestinationCount: 0,
      devMovedPercentOfSupply: null,
      devDestinationsStillTopHolders: 0,
      connectedCurrentSupplyPct: 0,
      similarLargeWalletCount: 0,
      similarLargeWalletCombinedPct: 0,
      sampledHolderCount: 0,
    },
    scannedAt: Date.now(),
  };
}

async function fetchHolderShares(
  tokenAddress: Address,
  poolAddress?: string | null,
): Promise<HolderShare[]> {
  const metadata = await getRobinhoodTokenMetadata(tokenAddress);
  if (metadata.totalSupplyRaw == null || metadata.totalSupplyRaw <= 0n) {
    throw new Error('total supply unavailable for bundle analysis');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_750);
  let response: Response;
  try {
    response = await fetch(`${BLOCKSCOUT_BASE}/api/v2/tokens/${tokenAddress}/holders`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`Blockscout holders HTTP ${response.status}`);
  const payload = await response.json() as HolderResponse;
  const rows = Array.isArray(payload.items) ? payload.items : [];

  const excluded = new Set([
    normalized(poolAddress),
    normalized(PONS_CONTRACTS.locker),
    normalized(PONS_CONTRACTS.positionManager),
    ZERO_ADDRESS,
    DEAD_ADDRESS,
  ].filter(Boolean));

  return rows.map((row) => {
    const addressInfo = row.address_hash ?? row.address;
    const wallet = String(addressInfo?.hash ?? '').trim();
    let value = 0n;
    try { value = BigInt(row.value ?? '0'); } catch { value = 0n; }
    return {
      wallet,
      value,
      isContract: Boolean(addressInfo?.is_contract),
    };
  })
    .filter((row) => row.wallet && row.value > 0n && !row.isContract && !excluded.has(normalized(row.wallet)))
    .map((row) => ({
      wallet: getAddress(row.wallet),
      value: row.value,
      sharePct: percentage(row.value, metadata.totalSupplyRaw!),
    }))
    .sort((a, b) => b.sharePct - a.sharePct)
    .slice(0, 20);
}

function findSimilarLargeWalletCluster(holders: HolderShare[]) {
  const candidates = holders.filter((holder) => holder.sharePct >= 0.5 && holder.sharePct <= 12).slice(0, 12);
  let best: HolderShare[] = [];

  for (const anchor of candidates) {
    const lower = anchor.sharePct * 0.75;
    const upper = anchor.sharePct * 1.25;
    const group = candidates.filter((holder) => holder.sharePct >= lower && holder.sharePct <= upper);
    if (group.length > best.length) best = group;
  }

  return {
    wallets: best.map((holder) => holder.wallet),
    count: best.length,
    combinedPct: best.reduce((sum, holder) => sum + holder.sharePct, 0),
  };
}

export async function scanRobinhoodBundleIntelligence(
  tokenAddress: string,
  options: {
    poolAddress?: string | null;
    devMovement?: RobinhoodDevMovementResult;
  } = {},
): Promise<RobinhoodBundleIntelligenceResult> {
  const token = getAddress(tokenAddress);

  try {
    const launch = await getPonsLaunchState(token);
    if (!launch.exists) return unknown(token, 'verified PONS deployer unavailable');

    const [holders, movement] = await Promise.all([
      fetchHolderShares(token, options.poolAddress),
      options.devMovement ? Promise.resolve(options.devMovement) : scanRobinhoodDevMovement(token),
    ]);

    if (holders.length < 5) return unknown(token, 'insufficient circulating holder evidence for bundle analysis');
    if (movement.status === 'UNKNOWN') return unknown(token, 'developer transfer history unavailable');

    const holderByWallet = new Map(holders.map((holder) => [normalized(holder.wallet), holder]));
    const nonBurnDestinations = movement.destinations.filter((wallet) => {
      const key = normalized(wallet);
      return key !== ZERO_ADDRESS && key !== DEAD_ADDRESS;
    });

    const connectedCurrent = nonBurnDestinations
      .map((wallet) => holderByWallet.get(normalized(wallet)))
      .filter((holder): holder is HolderShare => Boolean(holder));

    const connectedCurrentSupplyPct = connectedCurrent.reduce((sum, holder) => sum + holder.sharePct, 0);
    const similar = findSimilarLargeWalletCluster(holders);
    const directSpreadCount = new Set(nonBurnDestinations.map(normalized)).size;
    const movedPct = movement.movedPercentOfSupply;

    let score = 0;
    const reasons: string[] = [];
    const connectedWallets = new Set<string>(connectedCurrent.map((holder) => holder.wallet));

    // Strongest evidence: verified deployer directly spread meaningful supply across
    // multiple wallets. This is the exact hidden-distribution pattern the gate is
    // designed to catch before a DEX-paid alert is actionable.
    if (directSpreadCount >= 5 && movedPct != null && movedPct >= 10) {
      score += 90;
      reasons.push(`deployer spread ${movedPct.toFixed(1)}% of supply across ${directSpreadCount} wallets`);
    } else if (directSpreadCount >= 3 && movedPct != null && movedPct >= 8) {
      score += 80;
      reasons.push(`deployer spread ${movedPct.toFixed(1)}% of supply across ${directSpreadCount} wallets`);
    } else if (directSpreadCount >= 2 && movedPct != null && movedPct >= 5) {
      score += 45;
      reasons.push(`deployer distributed ${movedPct.toFixed(1)}% of supply across ${directSpreadCount} wallets`);
    }

    // If dev-linked destinations are still major holders, measure their combined
    // current control rather than treating each wallet as independent.
    if (connectedCurrent.length >= 3 && connectedCurrentSupplyPct >= 10) {
      score += 50;
      reasons.push(`${connectedCurrent.length} dev-linked holders still control ${connectedCurrentSupplyPct.toFixed(1)}% combined`);
    } else if (connectedCurrent.length >= 2 && connectedCurrentSupplyPct >= 8) {
      score += 30;
      reasons.push(`${connectedCurrent.length} dev-linked holders control ${connectedCurrentSupplyPct.toFixed(1)}% combined`);
    }

    // Symmetric large positions can indicate deliberate wallet splitting. This is
    // supporting evidence only; it cannot independently produce a HIGH verdict.
    if (similar.count >= 6 && similar.combinedPct >= 18) {
      score += 35;
      reasons.push(`${similar.count} similarly-sized wallets control ${similar.combinedPct.toFixed(1)}% combined`);
    } else if (similar.count >= 5 && similar.combinedPct >= 15) {
      score += 25;
      reasons.push(`${similar.count} similarly-sized wallets control ${similar.combinedPct.toFixed(1)}% combined`);
    }

    score = Math.max(0, Math.min(100, score));
    const level: RobinhoodBundleIntelligenceResult['level'] =
      score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

    if (!reasons.length) reasons.push('no coordinated deployer-to-holder distribution pattern detected');

    const result: RobinhoodBundleIntelligenceResult = {
      tokenAddress: token,
      score,
      level,
      evidenceAvailable: true,
      reasons,
      connectedWallets: [...connectedWallets],
      metrics: {
        devSpreadDestinationCount: directSpreadCount,
        devMovedPercentOfSupply: movedPct,
        devDestinationsStillTopHolders: connectedCurrent.length,
        connectedCurrentSupplyPct: Math.round(connectedCurrentSupplyPct * 100) / 100,
        similarLargeWalletCount: similar.count,
        similarLargeWalletCombinedPct: Math.round(similar.combinedPct * 100) / 100,
        sampledHolderCount: holders.length,
      },
      scannedAt: Date.now(),
    };

    console.log('[RobinhoodBundleIntelligence] result', result);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn('[RobinhoodBundleIntelligence] unavailable', { tokenAddress: token, reason });
    return unknown(token, reason);
  }
}
