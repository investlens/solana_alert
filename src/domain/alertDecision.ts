export type AlertDecisionCategory =
  | 'HIGH_CONVICTION'
  | 'QUALIFIED'
  | 'WATCHLIST'
  | 'REJECTED';

export type AlertDecisionSeverity =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

export interface AlertDecisionReason {
  code: string;
  message: string;
  impact: number;
}

export interface AlertDecisionWarning {
  code: string;
  message: string;
  severity: AlertDecisionSeverity;
}

export interface AlertInvalidationRule {
  code: string;
  message: string;
}

export interface AlertDecision {
  /**
   * Final permission to continue into createAlertRecord().
   */
  shouldAlert: boolean;

  /**
   * Human-readable classification for Telegram,
   * dashboards and analytics.
   */
  category: AlertDecisionCategory;

  /**
   * Final orchestrator conviction from 0–100.
   *
   * This does not replace the scanner score.
   * It represents confidence in sending the alert.
   */
  confidence: number;

  /**
   * Existing adjusted score received from the scanner
   * after adaptive learning.
   */
  adjustedScore: number;

  /**
   * Optional confidence change calculated by the orchestrator.
   *
   * Example:
   * adjustedScore = 78
   * confidenceAdjustment = +6
   * confidence = 84
   */
  confidenceAdjustment: number;

  /**
   * Positive evidence supporting the decision.
   */
  reasons: AlertDecisionReason[];

  /**
   * Risks which do not necessarily block the alert.
   */
  warnings: AlertDecisionWarning[];

  /**
   * Conditions that would make the thesis invalid.
   */
  invalidationRules: AlertInvalidationRule[];

  /**
   * Machine-readable rejection reason.
   *
   * Present when shouldAlert is false.
   */
  rejectionCode?: string;

  /**
   * Human-readable rejection explanation.
   */
  rejectionReason?: string;

  /**
   * Timestamp of the orchestrator decision.
   */
  evaluatedAt: string;

  /**
   * Allows the decision structure to evolve without
   * changing every downstream consumer.
   */
  metadata?: Record<string, unknown>;
}

export interface AlertOrchestratorTokenInput {
  tokenAddress: string;
  chain: string;

  symbol?: string | null;
  name?: string | null;
  pairAddress?: string | null;
  creatorWallet?: string | null;
}

export interface AlertOrchestratorScoreInput {
  baseScore: number;
  adjustedScore: number;

  learningAdjustment: number;
  learningReasons: string[];

  actionBucket: string;
}

export interface AlertOrchestratorMarketInput {
  ageMin: number;

  price: number;
  marketCap: number;
  liquidityUsd: number;
  volume5m: number;

  buys5m: number;
  sells5m: number;
}

export interface AlertOrchestratorSafetyInput {
  riskLevel: string;

  marketSafetyScore: number;
  authoritySafetyScore: number;

  paidApproved: boolean;
}

export interface AlertOrchestratorThresholdInput {
  minimumAlertConfidence: number;

  minimumLiquidityUsd: number;
  minimumVolume5m: number;
  maximumAgeMin: number;

  minimumMarketSafetyScore: number;
  minimumAuthoritySafetyScore: number;
}

export interface AlertOrchestratorInput {
  token: AlertOrchestratorTokenInput;

  scores: AlertOrchestratorScoreInput;

  market: AlertOrchestratorMarketInput;

  safety: AlertOrchestratorSafetyInput;

  thresholds: AlertOrchestratorThresholdInput;

  /**
   * Future evidence can be added without breaking
   * the existing scanner integration.
   */
  intelligence?: {
    creatorScore?: number;
    holderScore?: number;
    smartWalletScore?: number;
    momentumScore?: number;
    socialScore?: number;
    bundleRiskScore?: number;
  };

  metadata?: Record<string, unknown>;
}