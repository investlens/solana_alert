import { recordAgentDecision } from './alphaLearningAgent.js';


export type DecisionInput = {
  score: number;
  marketSafetyScore: number;
  authoritySafetyScore: number;
  liquidityUsd: number;
  volume5m: number;
  buys5m: number;
  sells5m: number;
  holderRiskScore?: number;
  bundleRiskScore?: number;
  smartWalletCount?: number;
};

export type DecisionResult = {
  verdict:
    | 'AVOID'
    | 'WATCH'
    | 'SCALP'
    | 'BUY'
    | 'HIGH_CONVICTION';

  confidence: number;
  reasons: string[];
};

export function getDecision(
  input: DecisionInput
): DecisionResult {
  const reasons: string[] = [];

  let confidence = 50;

  if (input.score >= 80) {
    confidence += 20;
    reasons.push('Strong overall score');
  }

  if (input.marketSafetyScore >= 70) {
    confidence += 15;
    reasons.push('Good market safety');
  }

  if (input.authoritySafetyScore >= 40) {
    confidence += 10;
    reasons.push('Authority looks safe');
  }

  if (input.buys5m > input.sells5m) {
    confidence += 10;
    reasons.push('Buy pressure is positive');
  }

  if ((input.smartWalletCount ?? 0) >= 2) {
    confidence += 20;
    reasons.push('Multiple smart wallets detected');
  }

  if ((input.bundleRiskScore ?? 0) >= 70) {
    confidence -= 25;
    reasons.push('Bundle risk is high');
  }

  if ((input.holderRiskScore ?? 0) >= 70) {
    confidence -= 25;
    reasons.push('Holder concentration is risky');
  }

  confidence = Math.max(0, Math.min(100, confidence));

  let verdict: DecisionResult['verdict'] = 'AVOID';

  if (confidence >= 90) {
    verdict = 'HIGH_CONVICTION';
  } else if (confidence >= 80) {
    verdict = 'BUY';
  } else if (confidence >= 65) {
    verdict = 'SCALP';
  } else if (confidence >= 50) {
    verdict = 'WATCH';
  }

  return {
    verdict,
    confidence,
    reasons,
  };
}

export async function recordDecisionForToken(args: {
  token: string;
  symbol?: string | null;
  input: DecisionInput;
}) {
  const decision = getDecision(args.input);

  await recordAgentDecision({
    token: args.token,
    symbol: args.symbol ?? null,
    agent: 'DecisionAgent',
    decision:
      decision.verdict === 'HIGH_CONVICTION'
        ? 'BUY'
        : decision.verdict,
    reason: decision.reasons.join('; '),
    confidence: decision.confidence,
    inputData: args.input,
  });

  return decision;
}