export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export type RiskCategory =
  | 'LIQUIDITY'
  | 'CREATOR'
  | 'BUNDLE'
  | 'HOLDER'
  | 'AUTHORITY'
  | 'CONSOLIDATION'
  | 'WHALE_EXIT'
  | 'MOMENTUM'
  | 'DATA_QUALITY'
  | string;

export interface RiskFactor {
  category: RiskCategory;
  score: number;
  level: RiskLevel;
  title: string;
  explanation?: string;
  evidence?: Record<string, unknown>;
}

export interface RiskProfile {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  positives: string[];
  warnings: string[];
  blockers: string[];
  assessedAt: string;
  engineVersion: string;
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}
