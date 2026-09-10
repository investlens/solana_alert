import { supabase } from '../services/supabase.js';
import { recordOpportunityAndEmit } from '../services/opportunityService.js';

type SecondChanceCheckpointInput = {
  token: string;
  chain: string;
  eventType: string;
  marketCap?: number | null;
  liquidity?: number | null;
  price?: number | null;
  buys?: number | null;
  sells?: number | null;
  alphaScore?: number | null;
  aiConfidence?: number | null;
  riskLevel?: string | null;
  note?: string | null;
  raw?: Record<string, unknown> | null;
};

type PreviousCheckpoint = {
  market_cap: number | null;
  liquidity: number | null;
  buys: number | null;
  sells: number | null;
  alpha_score: number | null;
  created_at: string;
  raw: Record<string, unknown> | null;
};

const ELIGIBLE_CHECKPOINTS = new Set([
  'OUTCOME_5M',
  'OUTCOME_15M',
  'OUTCOME_30M',
]);

function n(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buyRatio(buys: number, sells: number): number {
  if (buys <= 0) return 0;
  if (sells <= 0) return buys;
  return buys / sells;
}

function checkpointMinutes(eventType: string): number {
  if (eventType === 'OUTCOME_5M') return 5;
  if (eventType === 'OUTCOME_15M') return 15;
  if (eventType === 'OUTCOME_30M') return 30;
  return 0;
}

async function alreadyAlerted(token: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('alerts')
    .select('id')
    .ilike('token_address', token)
    .limit(1);

  if (error) {
    console.warn('[SECOND_CHANCE] alert lookup failed; fail closed', {
      token,
      error: error.message,
    });
    return true;
  }

  return Boolean(data?.length);
}

async function previousCheckpoint(
  token: string,
  eventType: string,
): Promise<PreviousCheckpoint | null> {
  const currentMinutes = checkpointMinutes(eventType);
  if (currentMinutes <= 5) return null;

  const allowed = currentMinutes === 15
    ? ['OUTCOME_5M']
    : ['OUTCOME_15M', 'OUTCOME_5M'];

  const { data, error } = await supabase
    .from('token_memory_events')
    .select('market_cap,liquidity,buys,sells,alpha_score,created_at,raw')
    .eq('token', token)
    .in('event_type', allowed)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[SECOND_CHANCE] prior checkpoint lookup failed', {
      token,
      error: error.message,
    });
    return null;
  }

  return (data as PreviousCheckpoint | null) ?? null;
}

async function alreadyPromoted(token: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('opportunities')
    .select('id,status,recommended_action')
    .eq('asset_id', token)
    .eq('strategy_key', 'SOL_SECOND_CHANCE')
    .in('status', ['NEW', 'WATCHING', 'ACTIVE'])
    .limit(1);

  if (error) {
    console.warn('[SECOND_CHANCE] opportunity lookup failed; fail closed', {
      token,
      error: error.message,
    });
    return true;
  }

  return Boolean(data?.length);
}

export async function evaluateSecondChanceCheckpoint(
  input: SecondChanceCheckpointInput,
): Promise<void> {
  const chain = String(input.chain ?? '').toLowerCase();
  const eventType = String(input.eventType ?? '').toUpperCase();

  // Isolated Solana-only recovery path. Existing alert rules are untouched.
  if (chain !== 'solana' || !ELIGIBLE_CHECKPOINTS.has(eventType)) return;

  if (await alreadyAlerted(input.token)) return;
  if (await alreadyPromoted(input.token)) return;

  const raw = input.raw ?? {};
  const returnPct = n(raw.returnPct, Number.NaN);
  const marketCap = n(input.marketCap);
  const liquidity = n(input.liquidity);
  const buys = n(input.buys);
  const sells = n(input.sells);
  const score = n(input.alphaScore ?? input.aiConfidence);
  const ratio = buyRatio(buys, sells);
  const minutes = checkpointMinutes(eventType);

  if (!Number.isFinite(returnPct) || marketCap <= 0 || liquidity <= 0) return;

  const previous = await previousCheckpoint(input.token, eventType);
  const previousMc = n(previous?.market_cap);
  const previousLiq = n(previous?.liquidity);
  const previousReturn = previous?.raw
    ? n(previous.raw.returnPct, Number.NaN)
    : Number.NaN;

  const liquidityRetention = previousLiq > 0
    ? liquidity / previousLiq
    : 1;

  const continuedStrength =
    !Number.isFinite(previousReturn) ||
    returnPct >= previousReturn - 10;

  const structureHealthy =
    liquidity >= 15_000 &&
    liquidityRetention >= 0.90 &&
    buys >= 150 &&
    ratio >= 1.35 &&
    score >= 55;

  // Very fast breakouts are allowed to trigger a review with a slightly
  // lower buy ratio, but still require real liquidity and participation.
  const breakoutAcceleration =
    returnPct >= 100 &&
    liquidity >= 25_000 &&
    buys >= 300 &&
    ratio >= 1.15 &&
    score >= 55;

  const earlyStrong =
    minutes === 5 &&
    returnPct >= 25 &&
    buys >= 250 &&
    ratio >= 1.8 &&
    liquidity >= 15_000 &&
    score >= 60;

  const sustainedStrong =
    minutes === 15 &&
    returnPct >= 30 &&
    structureHealthy &&
    continuedStrength;

  const confirmedStrong =
    minutes === 30 &&
    returnPct >= 60 &&
    structureHealthy &&
    continuedStrength;

  if (!(earlyStrong || sustainedStrong || confirmedStrong || breakoutAcceleration)) {
    console.log('[SECOND_CHANCE] checkpoint observed but not promoted', {
      token: input.token,
      eventType,
      returnPct: Number(returnPct.toFixed(1)),
      liquidity: Math.round(liquidity),
      buys,
      sells,
      buyRatio: Number(ratio.toFixed(2)),
      score,
      liquidityRetention: Number(liquidityRetention.toFixed(2)),
      continuedStrength,
    });
    return;
  }

  const trigger = breakoutAcceleration
    ? 'BREAKOUT_ACCELERATION'
    : earlyStrong
      ? 'EARLY_STRONG'
      : sustainedStrong
        ? 'SUSTAINED_15M'
        : 'CONFIRMED_30M';

  const confidence = Math.max(
    70,
    Math.min(
      90,
      Math.round(
        score +
        Math.min(8, Math.max(0, returnPct / 25)) +
        Math.min(5, Math.max(0, ratio - 1)),
      ),
    ),
  );

  const riskScore = input.riskLevel === 'HIGH'
    ? 68
    : input.riskLevel === 'MEDIUM'
      ? 48
      : 30;

  const priorMoveText = Number.isFinite(previousReturn)
    ? ` Previous checkpoint was ${previousReturn.toFixed(1)}%.`
    : '';

  await recordOpportunityAndEmit({
    opportunityType: 'DEX_CONFIRMATION',
    assetId: input.token,
    chain: 'solana',
    sourceAgent: 'SecondChanceMomentumEngine',
    title: `Second-Chance Momentum: ${input.token}`,
    strategyKey: 'SOL_SECOND_CHANCE',
    recommendedAction: 'CHECK_ENTRY',
    why:
      `Previously unalerted token now shows ${trigger.toLowerCase().replace(/_/g, ' ')}: ` +
      `${returnPct.toFixed(1)}% from first observation, buy ratio ${ratio.toFixed(2)}, ` +
      `liquidity $${Math.round(liquidity).toLocaleString()}.${priorMoveText}`,
    whatHappened:
      `AlphaOS re-evaluated an initially unalerted token at the ${minutes} minute checkpoint after market structure improved materially.`,
    invalidation:
      'Do not enter if live momentum reverses, liquidity deteriorates materially, sell pressure rises, or the current market structure no longer matches this checkpoint.',
    riskReason:
      'This is a second-chance momentum setup after the initial alert gate did not qualify. It requires live entry verification because fast-moving microcaps can reverse sharply.',
    entryPrice: n(input.price) || null,
    exitPrice: null,
    expectedProfit: null,
    expectedProfitPercent: null,
    riskScore,
    confidence,
    status: 'NEW',
    lastObservedAt: new Date().toISOString(),
    observationCount: previous ? 2 : 1,
    rawData: {
      strategy: 'SOL_SECOND_CHANCE',
      trigger,
      symbol: null,
      checkpoint: eventType,
      elapsedSec: minutes * 60,
      currentRoi: returnPct,
      recentPeakRoi: n(raw.maxReturnPct, returnPct),
      marketCap,
      liquidity,
      buys5m: buys,
      sells5m: sells,
      buyRatio: ratio,
      alphaScore: score,
      sourceRiskLevel: input.riskLevel ?? null,
      previousMarketCap: previousMc || null,
      previousLiquidity: previousLiq || null,
      previousReturnPct: Number.isFinite(previousReturn) ? previousReturn : null,
      liquidityRetention,
      continuedStrength,
      checkpointNote: input.note ?? null,
      secondChance: true,
    },
  });

  console.log('[SECOND_CHANCE] promoted for full opportunity delivery checks', {
    token: input.token,
    eventType,
    trigger,
    returnPct: Number(returnPct.toFixed(1)),
    buyRatio: Number(ratio.toFixed(2)),
    liquidity: Math.round(liquidity),
    score,
    confidence,
  });
}
