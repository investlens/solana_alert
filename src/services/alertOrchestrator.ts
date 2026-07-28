import type {
  AlertDecision,
  AlertOrchestratorInput,
} from '../domain/alertDecision.js';

export async function orchestrateAlert(
  input: AlertOrchestratorInput
): Promise<AlertDecision> {
  const confidence = input.scores.adjustedScore;

  return {
    shouldAlert:
      confidence >= input.thresholds.minimumAlertConfidence,

    category:
      confidence >= 90
        ? 'HIGH_CONVICTION'
        : 'QUALIFIED',

    confidence,

    adjustedScore: input.scores.adjustedScore,

    confidenceAdjustment: 0,

    reasons: [],

    warnings: [],

    invalidationRules: [],

    evaluatedAt: new Date().toISOString(),
  };
}