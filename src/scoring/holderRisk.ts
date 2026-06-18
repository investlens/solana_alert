import { fetchTopHolders } from '../core/helius.js';

export type HolderRisk = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  topHolderCount: number;
};

export async function getHolderRisk(
  mintAddress: string
): Promise<HolderRisk> {
  const holders = await fetchTopHolders(mintAddress);

  if (!holders.length) {
    return {
      score: 0,
      level: 'LOW',
      reasons: ['No holder data'],
      topHolderCount: 0,
    };
  }

  return {
    score: 0,
    level: 'LOW',
    reasons: [
      'Holder data visible, percentage scoring temporarily disabled',
    ],
    topHolderCount: holders.length,
  };
}