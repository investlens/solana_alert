import type { SupportedChain } from './token.js';

export type WalletReputationTier =
  | 'ELITE'
  | 'PROVEN'
  | 'PROMISING'
  | 'NEUTRAL'
  | 'WEAK'
  | 'UNKNOWN';

export interface WalletProfile {
  wallet: string;
  chain?: SupportedChain;
  label?: string | null;
  totalBuys: number;
  totalSells: number;
  tokensSeen: number;
  completedTrades: number;
  positiveTrades: number;
  failedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  averageRoi: number;
  bestRoi: number;
  average5mReturn?: number | null;
  average1hReturn?: number | null;
  averageMaxReturn?: number | null;
  averageHoldMinutes?: number | null;
  earlyEntryRate?: number | null;
  trustScore: number;
  reputationTier: WalletReputationTier;
  reputationSummary?: string | null;
  lastToken?: string | null;
  lastActivityAt?: string | null;
  updatedAt: string;
}
