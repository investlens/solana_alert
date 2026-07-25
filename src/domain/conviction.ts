import type { RiskProfile } from './risk.js';

export type ConvictionVerdict =
  | 'HIGH_CONVICTION'
  | 'GOOD_OPPORTUNITY'
  | 'SPECULATIVE'
  | 'WATCHLIST'
  | 'IGNORE'
  | 'BLOCKED';

export type DecisionAction =
  | 'BUY_CANDIDATE'
  | 'WATCH'
  | 'IGNORE'
  | 'BLOCK';

export interface ScoreContribution {
  code: string;
  label: string;
  points: number;
  category?: string;
  evidence?: Record<string, unknown>;
}

export interface AIConviction {
  opportunityScore: number;
  confidenceScore: number;
  riskScore: number;
  verdict: ConvictionVerdict;
  action: DecisionAction;
  contributions: ScoreContribution[];
  reasons: string[];
  missingEvidence: string[];
  riskProfile?: RiskProfile | null;
  engineVersion: string;
  decidedAt: string;
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
