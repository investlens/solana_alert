import { fetchEnhancedTransactionsForAddress } from '../core/helius.js';

export type ConsolidationRisk = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  destinationWallets: string[];
};

export async function getConsolidationRisk(
  mintAddress: string,
  buyers: string[]
): Promise<ConsolidationRisk> {
  if (!buyers.length) {
    return {
      score: 0,
      level: 'LOW',
      reasons: ['No early buyers detected'],
      destinationWallets: [],
    };
  }

  const destinationCounts = new Map<string, number>();

  for (const wallet of buyers.slice(0, 5)) {
    const txs = await fetchEnhancedTransactionsForAddress(wallet, 20);

    for (const tx of txs) {
      for (const transfer of tx.tokenTransfers ?? []) {
        if (transfer.mint !== mintAddress) continue;
        if (!transfer.fromUserAccount || !transfer.toUserAccount) continue;
        if (transfer.fromUserAccount === transfer.toUserAccount) continue;

        const current = destinationCounts.get(transfer.toUserAccount) ?? 0;
        destinationCounts.set(transfer.toUserAccount, current + 1);
      }
    }
  }

  const suspiciousDestinations = [...destinationCounts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([wallet]) => wallet);

  if (suspiciousDestinations.length > 0) {
    return {
      score: 80,
      level: 'HIGH',
      reasons: [
        'Multiple early buyers transferred tokens to the same wallet',
        'Possible bundled consolidation before dump',
      ],
      destinationWallets: suspiciousDestinations,
    };
  }

  return {
    score: 0,
    level: 'LOW',
    reasons: ['No consolidation detected'],
    destinationWallets: [],
  };
}