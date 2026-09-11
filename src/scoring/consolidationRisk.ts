import { fetchEnhancedTransactionsForAddress } from '../core/helius.js';
import { getBundleIntelligenceV2 } from './bundleIntelligenceV2.js';

export type ConsolidationRisk = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  destinationWallets: string[];
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function getLegacyConsolidationRisk(
  mintAddress: string,
  buyers: string[]
): Promise<ConsolidationRisk> {
  if (!buyers.length) {
    return {
      score: 0,
      level: 'LOW',
      reasons: ['No watched-wallet consolidation evidence'],
      destinationWallets: [],
    };
  }

  const destinationCounts = new Map<string, number>();
  const walletsToInspect = buyers.slice(0, 3);

  for (let index = 0; index < walletsToInspect.length; index += 1) {
    const wallet = walletsToInspect[index];

    try {
      const txs = await fetchEnhancedTransactionsForAddress(wallet, 10);

      for (const tx of txs) {
        for (const transfer of tx.tokenTransfers ?? []) {
          if (transfer.mint !== mintAddress) continue;
          if (!transfer.fromUserAccount || !transfer.toUserAccount) continue;
          if (transfer.fromUserAccount === transfer.toUserAccount) continue;

          destinationCounts.set(
            transfer.toUserAccount,
            (destinationCounts.get(transfer.toUserAccount) ?? 0) + 1
          );
        }
      }
    } catch (error) {
      console.log('consolidation wallet scan failed:', {
        mintAddress,
        wallet,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (index < walletsToInspect.length - 1) await sleep(800);
  }

  const suspiciousDestinations = [...destinationCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([wallet]) => wallet);

  if (suspiciousDestinations.length > 0) {
    return {
      score: 80,
      level: 'HIGH',
      reasons: [
        'Multiple watched buyers transferred tokens to the same wallet',
        'Possible bundled consolidation before dump',
      ],
      destinationWallets: suspiciousDestinations,
    };
  }

  return {
    score: 0,
    level: 'LOW',
    reasons: ['No watched-wallet consolidation detected'],
    destinationWallets: [],
  };
}

export async function getConsolidationRisk(
  mintAddress: string,
  buyers: string[]
): Promise<ConsolidationRisk> {
  // Bundle V2 inspects actual large holder owners and shared funding / fresh
  // wallet clusters. The legacy check remains as a second independent signal.
  // Either one may block an alert; neither changes production scoring/trading.
  const [bundleV2, legacy] = await Promise.all([
    getBundleIntelligenceV2(mintAddress),
    getLegacyConsolidationRisk(mintAddress, buyers),
  ]);

  const score = Math.max(bundleV2.score, legacy.score);
  const level = score >= 75 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  const reasons = [
    ...bundleV2.reasons.map((reason) => `Bundle V2: ${reason}`),
    ...legacy.reasons.map((reason) => `Legacy: ${reason}`),
  ];
  const destinationWallets = [
    ...new Set([
      ...bundleV2.connectedWallets,
      ...legacy.destinationWallets,
    ]),
  ];

  console.log('[BundleRisk] combined result', {
    mintAddress,
    score,
    level,
    bundleV2Score: bundleV2.score,
    bundleV2EvidenceAvailable: bundleV2.evidenceAvailable,
    bundleV2Metrics: bundleV2.metrics,
    legacyScore: legacy.score,
    reasons,
    connectedWallets: destinationWallets.length,
  });

  return {
    score,
    level,
    reasons,
    destinationWallets,
  };
}
