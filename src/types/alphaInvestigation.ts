import type { DexPair, RiskResult } from '../types.js';

export type AlphaVerdict =
  | 'STRONG_OPPORTUNITY'
  | 'WORTH_WATCHING'
  | 'HIGH_RISK'
  | 'AVOID'
  | 'INSUFFICIENT_EVIDENCE';

export type AlphaSuggestedAction =
  | 'INVESTIGATE_FURTHER'
  | 'MONITOR_CLOSELY'
  | 'WAIT_FOR_CONFIRMATION'
  | 'HIGH_RISK_SPECULATION'
  | 'AVOID';

export type ChecklistStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export type AlphaChecklistItem = {
  label: string;
  status: ChecklistStatus;
  detail: string;
};

export type AlphaMetric = {
  label: string;
  value: string;
  status?: ChecklistStatus;
};

export type AlphaCreatorProfile = {
  wallet: string | null;
  rating: 'PROVEN' | 'PROMISING' | 'UNKNOWN' | 'RISKY' | 'AVOID';
  trustScore: number;
  launches: number;
  successfulLaunches: number;
  failedLaunches: number;
  rugs: number;
  highestMarketCap: number;
  averageMarketCap: number;
  bestToken: string | null;
  bestSymbol: string | null;
  summary: string;
  hasData: boolean;
};

export type AlphaInvestigation = {
  tokenAddress: string;
  chain: string;
  symbol: string;
  name: string;
  url?: string | null;

  verdict: AlphaVerdict;
  confidence: number;
  suggestedAction: AlphaSuggestedAction;

  executiveSummary: string;

  checklist: AlphaChecklistItem[];

  market: {
    marketCap: number;
    fdv: number;
    liquidityUsd: number;
    volume5m: number;
    buys5m: number;
    sells5m: number;
    ageMin: number;
    priceUsd: number | null;
  };

  safety: {
    marketSafetyScore: number;
    marketSafetyLabel: RiskResult['marketSafetyLabel'];
    authoritySafetyScore: number;
    authoritySafetyLabel: RiskResult['authoritySafetyLabel'];
    mintAuthority: string | null;
    freezeAuthority: string | null;
    isMutable: boolean | null;
  };

  creator: AlphaCreatorProfile;

  evidence: string[];
  risks: string[];
  warnings: string[];

  source: {
    pair: DexPair;
    rawRiskResult: RiskResult;
  };

  createdAt: string;
};