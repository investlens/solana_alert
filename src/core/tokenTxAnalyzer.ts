import { fetchEnhancedTransactionsForAddress } from './helius.js';

export type EarlyBuyerScan = {
  buyers: string[];
  txCount: number;
};

export async function scanEarlyBuyers(token: string): Promise<EarlyBuyerScan> {
  const txs = await fetchEnhancedTransactionsForAddress(token, 100);

  console.log('helius tx count:', txs.length, 'for token:', token);

  const buyers = new Set<string>();

  for (const tx of txs) {
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== token) continue;
      if (t.toUserAccount) buyers.add(t.toUserAccount);
    }
  }

  return {
    buyers: [...buyers],
    txCount: txs.length,
  };
}

export async function getEarlyBuyers(token: string): Promise<string[]> {
  const scan = await scanEarlyBuyers(token);
  return scan.buyers;
}