import { scanEarlyBuyers } from '../core/tokenTxAnalyzer.js';

export type ConsolidationRisk = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  destinationWallets: string[];
};

export async function getConsolidationRisk(
  mintAddress: string
): Promise<ConsolidationRisk> {
  const scan = await scanEarlyBuyers(mintAddress);
  const buyers = scan.buyers;

  if (scan.txCount === 0) {
    return {
      score: 10,
      level: 'LOW',
      reasons: ['No Helius transaction visibility for mint'],
      destinationWallets: [],
    };
  }

  if (buyers.length === 0) {
    return {
      score: 15,
      level: 'LOW',
      reasons: [`Helius returned ${scan.txCount} txs but no buyer wallets`],
      destinationWallets: [],
    };
  }

  if (buyers.length <= 3) {
    return {
      score: 35,
      level: 'MEDIUM',
      reasons: [`Only ${buyers.length} early buyer wallets detected`],
      destinationWallets: [],
    };
  }

  return {
    score: 0,
    level: 'LOW',
    reasons: [`Found ${buyers.length} early buyers from ${scan.txCount} txs`],
    destinationWallets: [],
  };
}