import type { RecordDecisionInput } from '../services/decisionService.js';

export type EngineFactor = {
  key:
    | 'MARKET_QUALITY'
    | 'MOMENTUM'
    | 'CREATOR_QUALITY'
    | 'HISTORICAL_FIT'
    | 'RISK_CONTROL'
    | 'WALLET_QUALITY';
  score: number;
  confidence: number;
  available: boolean;
  contribution: number;
  reasons: string[];
};

export type DecisionEngineV2Context = {
  creator?: {
    trustScore?: number | null;
    confidenceScore?: number | null;
    totalLaunches?: number | null;
    successRate?: number | null;
    rugCount?: number | null;
    riskScore?: number | null;
  } | null;
  historical?: {
    sampleSize: number;
    medianRoi15m: number | null;
    hit20Rate: number | null;
    medianDrawdown: number | null;
  } | null;
  wallet?: {
    trustScore?: number | null;
    smartMoneyScore?: number | null;
    confidenceScore?: number | null;
    winRate?: number | null;
    completedTrades?: number | null;
  } | null;
};

export type DecisionEngineV2Result = {
  modelVersion: 'alphaos-decision-v2-shadow';
  score: number;
  delta: number;
  confidence: number;
  action: 'SHADOW_IGNORE' | 'SHADOW_BUY' | 'SHADOW_HIGH_BUY';
  factors: EngineFactor[];
  topPositiveReasons: string[];
  topNegativeReasons: string[];
  promotionEligible: boolean;
  guardrails: {
    maxDelta: number;
    affectsProduction: false;
    minimumConfidenceForPromotion: number;
    minimumAvailableFactorsForPromotion: number;
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function actionForScore(score: number): DecisionEngineV2Result['action'] {
  if (score >= 82) return 'SHADOW_HIGH_BUY';
  if (score >= 72) return 'SHADOW_BUY';
  return 'SHADOW_IGNORE';
}

function makeFactor(args: Omit<EngineFactor, 'contribution'> & { weight: number }): EngineFactor {
  const normalized = (args.score - 50) / 50;
  const confidenceWeight = args.confidence / 100;
  return {
    key: args.key,
    score: clamp(args.score, 0, 100),
    confidence: clamp(args.confidence, 0, 100),
    available: args.available,
    contribution: args.available ? normalized * args.weight * confidenceWeight : 0,
    reasons: args.reasons,
  };
}

function marketQualityFactor(input: RecordDecisionInput): EngineFactor {
  const liquidity = finite(input.liquidity);
  const volume = finite(input.volume5m);
  const marketCap = finite(input.marketCap);
  const marketSafety = finite(input.marketSafetyScore);

  let score = 50;
  let confidence = 0;
  const reasons: string[] = [];
  let observed = 0;

  if (liquidity != null) {
    observed += 1;
    confidence += 25;
    if (liquidity >= 15_000 && liquidity <= 30_000) {
      score += 14;
      reasons.push('liquidity_in_historical_sweet_spot');
    } else if (liquidity >= 8_000 && liquidity <= 60_000) {
      score += 6;
      reasons.push('liquidity_in_healthy_range');
    } else if (liquidity < 6_000) {
      score -= 22;
      reasons.push('liquidity_too_thin');
    } else if (liquidity > 100_000) {
      score -= 5;
      reasons.push('liquidity_outside_early_stage_profile');
    }
  }

  if (volume != null) {
    observed += 1;
    confidence += 20;
    if (volume >= 8_000) {
      score += 9;
      reasons.push('strong_5m_volume');
    } else if (volume >= 3_000) {
      score += 4;
      reasons.push('acceptable_5m_volume');
    } else {
      score -= 8;
      reasons.push('weak_5m_volume');
    }
  }

  if (marketCap != null) {
    observed += 1;
    confidence += 15;
    if (marketCap > 0 && marketCap <= 100_000) {
      score += 5;
      reasons.push('market_cap_matches_early_stage_profile');
    } else if (marketCap > 250_000) {
      score -= 7;
      reasons.push('market_cap_late_for_early_entry_profile');
    }
  }

  if (marketSafety != null) {
    observed += 1;
    confidence += 30;
    score += clamp((marketSafety - 60) * 0.35, -18, 14);
    reasons.push(marketSafety >= 70 ? 'market_safety_strong' : marketSafety < 60 ? 'market_safety_weak' : 'market_safety_acceptable');
  }

  return makeFactor({
    key: 'MARKET_QUALITY',
    score,
    confidence: clamp(confidence, 0, 100),
    available: observed > 0,
    weight: 5.0,
    reasons,
  });
}

function momentumFactor(input: RecordDecisionInput): EngineFactor {
  const buys = finite(input.buys5m);
  const sells = finite(input.sells5m);
  const volume = finite(input.volume5m);

  let score = 50;
  let confidence = 0;
  const reasons: string[] = [];

  if (buys != null && sells != null) {
    confidence += 55;
    const ratio = buys / Math.max(1, sells);
    if (ratio >= 2.5) {
      score += 28;
      reasons.push('buy_sell_ratio_exceptional');
    } else if (ratio >= 1.8) {
      score += 20;
      reasons.push('buy_sell_ratio_strong');
    } else if (ratio >= 1.4) {
      score += 10;
      reasons.push('buy_sell_ratio_positive');
    } else if (ratio < 1) {
      score -= 28;
      reasons.push('sell_pressure_dominant');
    } else {
      score -= 5;
      reasons.push('buy_pressure_unconvincing');
    }

    if (buys >= 100) {
      score += 8;
      reasons.push('high_buyer_activity');
    } else if (buys >= 40) {
      score += 4;
      reasons.push('buyer_activity_healthy');
    } else {
      score -= 5;
      reasons.push('buyer_activity_low');
    }
  }

  if (volume != null) {
    confidence += 20;
    if (volume >= 8_000) score += 6;
    else if (volume < 3_000) score -= 5;
  }

  return makeFactor({
    key: 'MOMENTUM',
    score,
    confidence: clamp(confidence, 0, 100),
    available: buys != null && sells != null,
    weight: 6.0,
    reasons,
  });
}

function creatorQualityFactor(context: DecisionEngineV2Context): EngineFactor {
  const creator = context.creator;
  const trust = finite(creator?.trustScore);
  const creatorConfidence = finite(creator?.confidenceScore);
  const launches = finite(creator?.totalLaunches) ?? 0;
  const successRate = finite(creator?.successRate);
  const rugCount = finite(creator?.rugCount) ?? 0;
  const riskScore = finite(creator?.riskScore);

  if (!creator || trust == null || launches < 2) {
    return makeFactor({
      key: 'CREATOR_QUALITY',
      score: 50,
      confidence: 0,
      available: false,
      weight: 4.5,
      reasons: ['insufficient_creator_history'],
    });
  }

  let score = trust;
  const reasons: string[] = [];

  if (successRate != null) {
    score = score * 0.7 + clamp(successRate, 0, 100) * 0.3;
    if (successRate >= 50) reasons.push('creator_success_rate_strong');
  }
  if (rugCount > 0) {
    score -= Math.min(35, rugCount * 12);
    reasons.push('creator_rug_history_penalty');
  }
  if (riskScore != null && riskScore >= 70) {
    score -= 12;
    reasons.push('creator_risk_high');
  }
  if (trust >= 80) reasons.push('creator_trust_high');
  if (trust <= 30) reasons.push('creator_trust_low');

  const confidence = clamp(
    (creatorConfidence ?? 45) * 0.65 + Math.min(35, launches * 4),
    0,
    100,
  );

  return makeFactor({
    key: 'CREATOR_QUALITY',
    score,
    confidence,
    available: true,
    weight: 4.5,
    reasons,
  });
}

function historicalFitFactor(context: DecisionEngineV2Context): EngineFactor {
  const prior = context.historical;
  if (!prior || prior.sampleSize < 8 || prior.medianRoi15m == null || prior.hit20Rate == null) {
    return makeFactor({
      key: 'HISTORICAL_FIT',
      score: 50,
      confidence: 0,
      available: false,
      weight: 5.0,
      reasons: ['insufficient_historical_comparables'],
    });
  }

  let score = 50;
  const reasons: string[] = [];
  score += clamp(prior.medianRoi15m * 0.9, -25, 25);
  score += clamp((prior.hit20Rate - 0.25) * 70, -18, 24);

  if (prior.medianDrawdown != null && prior.medianDrawdown < -30) {
    score -= 10;
    reasons.push('historical_drawdown_high');
  }
  if (prior.medianRoi15m >= 10) reasons.push('historical_median_roi_positive');
  if (prior.hit20Rate >= 0.35) reasons.push('historical_hit_rate_strong');
  if (prior.medianRoi15m < 0) reasons.push('historical_median_roi_negative');

  return makeFactor({
    key: 'HISTORICAL_FIT',
    score,
    confidence: clamp(prior.sampleSize * 3, 0, 100),
    available: true,
    weight: 5.0,
    reasons,
  });
}

function riskControlFactor(input: RecordDecisionInput): EngineFactor {
  const marketSafety = finite(input.marketSafetyScore);
  const authoritySafety = finite(input.authoritySafetyScore);
  const paidApproved = input.paidApproved;
  const reasons: string[] = [];
  let score = 50;
  let confidence = 0;
  let observed = 0;

  if (marketSafety != null) {
    observed += 1;
    confidence += 35;
    score += clamp((marketSafety - 60) * 0.4, -22, 16);
    if (marketSafety < 50) reasons.push('market_safety_risk');
  }
  if (authoritySafety != null) {
    observed += 1;
    confidence += 35;
    score += clamp((authoritySafety - 60) * 0.35, -20, 14);
    if (authoritySafety < 50) reasons.push('authority_safety_risk');
  }
  if (paidApproved != null) {
    observed += 1;
    confidence += 20;
    if (paidApproved) {
      score += 5;
      reasons.push('paid_approval_present');
    } else {
      score -= 3;
      reasons.push('paid_approval_absent');
    }
  }

  return makeFactor({
    key: 'RISK_CONTROL',
    score,
    confidence: clamp(confidence, 0, 100),
    available: observed > 0,
    weight: 5.5,
    reasons,
  });
}

function walletQualityFactor(context: DecisionEngineV2Context): EngineFactor {
  const wallet = context.wallet;
  const trust = finite(wallet?.trustScore);
  const smartMoney = finite(wallet?.smartMoneyScore);
  const winRate = finite(wallet?.winRate);
  const completed = finite(wallet?.completedTrades) ?? 0;
  const sourceConfidence = finite(wallet?.confidenceScore);

  if (!wallet || completed < 3 || (trust == null && smartMoney == null && winRate == null)) {
    return makeFactor({
      key: 'WALLET_QUALITY',
      score: 50,
      confidence: 0,
      available: false,
      weight: 4.0,
      reasons: ['insufficient_wallet_evidence'],
    });
  }

  const inputs = [trust, smartMoney, winRate].filter((v): v is number => v != null);
  const score = inputs.reduce((a, b) => a + b, 0) / inputs.length;
  const reasons = [score >= 70 ? 'wallet_quality_strong' : score <= 35 ? 'wallet_quality_weak' : 'wallet_quality_neutral'];
  const confidence = clamp((sourceConfidence ?? 45) * 0.6 + Math.min(40, completed * 4), 0, 100);

  return makeFactor({
    key: 'WALLET_QUALITY',
    score,
    confidence,
    available: true,
    weight: 4.0,
    reasons,
  });
}

export function runDecisionEngineV2(
  input: RecordDecisionInput,
  context: DecisionEngineV2Context,
): DecisionEngineV2Result {
  const factors = [
    marketQualityFactor(input),
    momentumFactor(input),
    creatorQualityFactor(context),
    historicalFitFactor(context),
    riskControlFactor(input),
    walletQualityFactor(context),
  ];

  const rawDelta = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const delta = clamp(rawDelta, -10, 10);
  const score = clamp(input.adjustedScore + delta, 0, 100);

  const available = factors.filter((factor) => factor.available);
  const confidence = available.length
    ? clamp(
        available.reduce((sum, factor) => sum + factor.confidence, 0) / available.length,
        0,
        100,
      )
    : 0;

  const ranked = [...factors].sort((a, b) => b.contribution - a.contribution);
  const topPositiveReasons = ranked
    .filter((f) => f.contribution > 0)
    .slice(0, 3)
    .flatMap((f) => f.reasons.slice(0, 1));
  const topNegativeReasons = [...ranked]
    .reverse()
    .filter((f) => f.contribution < 0)
    .slice(0, 3)
    .flatMap((f) => f.reasons.slice(0, 1));

  const minimumConfidenceForPromotion = 70;
  const minimumAvailableFactorsForPromotion = 4;

  return {
    modelVersion: 'alphaos-decision-v2-shadow',
    score,
    delta,
    confidence,
    action: actionForScore(score),
    factors,
    topPositiveReasons,
    topNegativeReasons,
    promotionEligible:
      confidence >= minimumConfidenceForPromotion &&
      available.length >= minimumAvailableFactorsForPromotion,
    guardrails: {
      maxDelta: 10,
      affectsProduction: false,
      minimumConfidenceForPromotion,
      minimumAvailableFactorsForPromotion,
    },
  };
}
