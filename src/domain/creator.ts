import type { SupportedChain } from './token.js';

export type CreatorTrustTier =
  | 'ELITE'
  | 'TRUSTED'
  | 'NEUTRAL'
  | 'WATCH'
  | 'HIGH_RISK'
  | 'UNKNOWN';

export interface CreatorProfile {
  creatorWallet: string;
  chain?: SupportedChain;
  totalLaunches: number;
  successfulLaunches: number;
  failedLaunches: number;
  rugCount?: number;
  bestMarketCapUsd: number;
  averageMarketCapUsd: number;
  medianMarketCapUsd?: number;
  successRate: number;
  trustScore: number;
  trustTier: CreatorTrustTier;
  averageMigrationMinutes?: number | null;
  lastToken?: string | null;
  lastSeenAt?: string | null;
  evidenceCount?: number;
  rawData?: Record<string, unknown>;
  updatedAt: string;
}

export function creatorSuccessRate(
  successfulLaunches: number,
  totalLaunches: number,
): number {
  if (totalLaunches <= 0) return 0;
  return Math.round((successfulLaunches / totalLaunches) * 10_000) / 100;
}
