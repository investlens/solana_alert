import { fetchEnhancedTransactionsForAddress } from '../core/helius.js';

export type ConsolidationRisk = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  destinationWallets: string[];
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

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

  // Only inspect the first three early buyers.
  // This protects the Helius allowance while still providing a useful signal.
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

          const current =
            destinationCounts.get(transfer.toUserAccount) ?? 0;

          destinationCounts.set(
            transfer.toUserAccount,
            current + 1
          );
        }
      }
    } catch (error) {
      console.log('consolidation wallet scan failed:', {
        mintAddress,
        wallet,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }

    // Avoid sending all Helius requests in one burst.
    if (index < walletsToInspect.length - 1) {
      await sleep(800);
    }
  }

  const suspiciousDestinations = [...destinationCounts.entries()]
    .filter(([, count]) => count >= 2)
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