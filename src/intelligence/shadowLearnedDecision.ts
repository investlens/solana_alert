import { supabase } from '../services/supabase.js';
import type { RecordDecisionInput } from '../services/decisionService.js';

type HistoricalPrior = {
  sampleSize: number;
  medianRoi15m: number | null;
  hit20Rate: number | null;
  medianDrawdown: number | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function shadowAction(score: number) {
  if (score >= 82) return 'SHADOW_HIGH_BUY';
  if (score >= 72) return 'SHADOW_BUY';
  return 'SHADOW_IGNORE';
}

async function loadCreatorEvidence(input: RecordDecisionInput) {
  if (!input.creatorWallet) return null;

  const { data, error } = await supabase
    .from('creator_intelligence')
    .select(
      'trust_score,confidence_score,total_launches,successful_launches,failed_launches,rug_count,success_rate,best_market_cap,risk_score,trust_label',
    )
    .eq('chain', input.chain?.trim() || 'solana')
    .eq('creator_wallet', input.creatorWallet)
    .maybeSingle();

  if (error) {
    console.warn('[ShadowLearnedDecision] creator lookup failed:', error.message);
    return null;
  }

  return data ?? null;
}

async function loadHistoricalPrior(input: RecordDecisionInput): Promise<HistoricalPrior> {
  const liquidity = finite(input.liquidity);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    let query = supabase
      .from('alpha_alert_outcomes')
      .select(
        'current_roi,max_drawdown,alpha_alert_events!inner(liquidity,chain)',
      )
      .eq('status', 'MEASURED')
      .eq('checkpoint_seconds', 900)
      .gte('measured_at', since)
      .limit(500);

    const chain = input.chain?.trim();
    if (chain) {
      query = query.eq('alpha_alert_events.chain', chain);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[ShadowLearnedDecision] historical prior lookup failed:', error.message);
      return { sampleSize: 0, medianRoi15m: null, hit20Rate: null, medianDrawdown: null };
    }

    const comparable = (data ?? []).filter((row: any) => {
      if (liquidity == null || liquidity <= 0) return true;
      const eventLiquidity = finite(row?.alpha_alert_events?.liquidity);
      if (eventLiquidity == null || eventLiquidity <= 0) return false;
      return eventLiquidity >= liquidity * 0.5 && eventLiquidity <= liquidity * 1.5;
    });

    const rois = comparable
      .map((row: any) => finite(row.current_roi))
      .filter((v: number | null): v is number => v != null && v >= -100 && v <= 500);

    const drawdowns = comparable
      .map((row: any) => finite(row.max_drawdown))
      .filter((v: number | null): v is number => v != null && v >= -100 && v <= 0);

    return {
      sampleSize: rois.length,
      medianRoi15m: median(rois),
      hit20Rate: rois.length ? rois.filter((v) => v >= 20).length / rois.length : null,
      medianDrawdown: median(drawdowns),
    };
  } catch (error) {
    console.warn(
      '[ShadowLearnedDecision] historical prior exception:',
      error instanceof Error ? error.message : String(error),
    );
    return { sampleSize: 0, medianRoi15m: null, hit20Rate: null, medianDrawdown: null };
  }
}

export async function recordShadowLearnedDecision(input: RecordDecisionInput) {
  const tokenAddress = input.tokenAddress.trim();
  if (!tokenAddress) return;

  const [creator, prior] = await Promise.all([
    loadCreatorEvidence(input),
    loadHistoricalPrior(input),
  ]);

  let adjustment = 0;
  const reasons: string[] = [];

  const buys = finite(input.buys5m);
  const sells = finite(input.sells5m);
  const buyRatio = buys != null && sells != null ? buys / Math.max(1, sells) : null;

  if (buyRatio != null) {
    if (buyRatio >= 2.5) {
      adjustment += 4;
      reasons.push('strong_buy_ratio_2_5_plus');
    } else if (buyRatio >= 1.8) {
      adjustment += 3;
      reasons.push('strong_buy_ratio_1_8_plus');
    } else if (buyRatio >= 1.4) {
      adjustment += 1;
      reasons.push('positive_buy_ratio_1_4_plus');
    } else if (buyRatio < 1) {
      adjustment -= 4;
      reasons.push('sell_pressure_ratio_below_1');
    }
  }

  const liquidity = finite(input.liquidity);
  if (liquidity != null) {
    if (liquidity >= 15_000 && liquidity <= 30_000) {
      adjustment += 2;
      reasons.push('historical_liquidity_sweet_spot');
    } else if (liquidity < 6_000) {
      adjustment -= 3;
      reasons.push('thin_liquidity');
    }
  }

  const creatorTrust = finite(creator?.trust_score);
  const creatorConfidence = finite(creator?.confidence_score);
  const creatorLaunches = finite(creator?.total_launches) ?? 0;
  if (creatorTrust != null && creatorLaunches >= 2) {
    const evidenceWeight = creatorConfidence == null ? 0.5 : clamp(creatorConfidence / 100, 0.25, 1);
    if (creatorTrust >= 80) {
      adjustment += 4 * evidenceWeight;
      reasons.push('proven_creator_positive');
    } else if (creatorTrust <= 30) {
      adjustment -= 5 * evidenceWeight;
      reasons.push('weak_creator_history');
    }
  }

  if (prior.sampleSize >= 12 && prior.medianRoi15m != null && prior.hit20Rate != null) {
    if (prior.medianRoi15m >= 10 && prior.hit20Rate >= 0.35) {
      adjustment += 3;
      reasons.push('positive_robust_15m_prior');
    } else if (prior.medianRoi15m < 0 && prior.hit20Rate < 0.2) {
      adjustment -= 3;
      reasons.push('negative_robust_15m_prior');
    }
  }

  // Keep shadow learning conservative. It may disagree with production, but it
  // cannot move the comparison score by more than ten points either way.
  adjustment = clamp(adjustment, -10, 10);
  const shadowScore = clamp(input.adjustedScore + adjustment, 0, 100);

  const featureCount = [buyRatio, liquidity, creatorTrust, prior.medianRoi15m]
    .filter((v) => v != null).length;
  const sampleConfidence = Math.min(40, prior.sampleSize * 2);
  const featureConfidence = featureCount * 12;
  const creatorEvidenceConfidence = creatorLaunches >= 2 ? 12 : 0;
  const confidence = clamp(sampleConfidence + featureConfidence + creatorEvidenceConfidence, 0, 100);

  const evidence = {
    mode: 'SHADOW_ONLY',
    reasons,
    features: {
      buyRatio,
      liquidity,
      volume5m: finite(input.volume5m),
      buys5m: buys,
      sells5m: sells,
    },
    creator: creator
      ? {
          trustScore: creatorTrust,
          confidenceScore: creatorConfidence,
          totalLaunches: creatorLaunches,
          successRate: finite(creator.success_rate),
          rugCount: finite(creator.rug_count),
          riskScore: finite(creator.risk_score),
          trustLabel: creator.trust_label ?? null,
        }
      : null,
    historicalPrior: prior,
    guardrails: {
      maxAdjustment: 10,
      usesMedianNotMean: true,
      affectsProductionDecision: false,
      affectsAlerts: false,
      affectsTrading: false,
    },
  };

  const { error } = await supabase.from('shadow_intelligence_decisions').insert({
    token_address: tokenAddress,
    chain: input.chain?.trim() || 'solana',
    source: input.source?.trim() || 'MAIN_SCANNER',
    symbol: input.symbol ?? null,
    creator_wallet: input.creatorWallet ?? null,
    current_action: input.actionBucket,
    base_score: input.baseScore,
    current_adjusted_score: input.adjustedScore,
    shadow_score: shadowScore,
    shadow_action: shadowAction(shadowScore),
    confidence,
    score_delta: adjustment,
    evidence,
  });

  if (error) {
    console.warn('[ShadowLearnedDecision] persistence failed:', error.message);
    return;
  }

  console.log('[ShadowLearnedDecision] recorded', {
    token: tokenAddress,
    currentAction: input.actionBucket,
    shadowAction: shadowAction(shadowScore),
    currentScore: input.adjustedScore,
    shadowScore: Number(shadowScore.toFixed(2)),
    delta: Number(adjustment.toFixed(2)),
    confidence,
  });
}
