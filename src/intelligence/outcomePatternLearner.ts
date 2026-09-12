import { supabase } from '../services/supabase.js';

const RUN_INTERVAL_MS = 60 * 60 * 1000;
const MIN_MEASURED_SIDE = 20;
const MIN_EMERGING_SIDE = 6;

type Direction = 'INCREASE_WEIGHT' | 'DECREASE_WEIGHT' | 'ADD_GATE' | 'RELAX_GATE' | 'OBSERVE_MORE';

type Recommendation = {
  scope: string;
  factorKey: string;
  direction: Direction;
  title: string;
  rationale: string;
  winnerSampleSize: number;
  loserSampleSize: number;
  effectSize: number | null;
  confidence: number | null;
  evidence: Record<string, unknown>;
};

type LegacyAlert = {
  token_address: string;
  alerted_at: string;
  score_at_alert: number | null;
  alert_price: number | null;
  high_price_after_alert: number | null;
  liquidity_at_alert: number | null;
  volume5m_at_alert: number | null;
  buys5m_at_alert: number | null;
  sells5m_at_alert: number | null;
};

type Sample = LegacyAlert & { multiple: number; buySellRatio: number | null };

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function confidenceFromSamples(winners: number, losers: number, effect: number | null): number {
  const sampleConfidence = Math.min(1, Math.min(winners, losers) / 50);
  const effectConfidence = effect == null ? 0 : Math.min(1, Math.abs(effect) / 1.5);
  return Number((100 * (sampleConfidence * 0.65 + effectConfidence * 0.35)).toFixed(1));
}

function recommendationForBinaryFactor(args: {
  scope: string;
  factorKey: string;
  title: string;
  winners: Sample[];
  losers: Sample[];
  predicate: (sample: Sample) => boolean;
  evidence?: Record<string, unknown>;
}): Recommendation {
  const winnerHit = args.winners.filter(args.predicate).length;
  const loserHit = args.losers.filter(args.predicate).length;
  const winnerRate = args.winners.length ? winnerHit / args.winners.length : 0;
  const loserRate = args.losers.length ? loserHit / args.losers.length : 0;
  const lift = loserRate > 0 ? winnerRate / loserRate : winnerRate > 0 ? 99 : 1;
  const enoughMeasured = args.winners.length >= MIN_MEASURED_SIDE && args.losers.length >= MIN_MEASURED_SIDE;
  const enoughEmerging = args.winners.length >= MIN_EMERGING_SIDE && args.losers.length >= MIN_EMERGING_SIDE;
  let direction: Direction = 'OBSERVE_MORE';
  if (enoughMeasured) {
    if (lift >= 1.35) direction = 'INCREASE_WEIGHT';
    else if (lift <= 0.75) direction = 'DECREASE_WEIGHT';
  }
  const confidence = enoughEmerging ? confidenceFromSamples(args.winners.length, args.losers.length, lift - 1) : null;
  const rationale = enoughMeasured
    ? `Factor appeared in ${(winnerRate * 100).toFixed(1)}% of measured winners vs ${(loserRate * 100).toFixed(1)}% of measured losers (lift ${lift.toFixed(2)}x).`
    : `Pattern is being tracked, but the measured winner/loser sample is still too small for an automatic scoring recommendation.`;
  return {
    scope: args.scope,
    factorKey: args.factorKey,
    direction,
    title: args.title,
    rationale,
    winnerSampleSize: args.winners.length,
    loserSampleSize: args.losers.length,
    effectSize: Number.isFinite(lift) ? Number(lift.toFixed(4)) : null,
    confidence,
    evidence: {
      winnerHit,
      loserHit,
      winnerRate,
      loserRate,
      lift,
      minimumMeasuredSide: MIN_MEASURED_SIDE,
      ...args.evidence,
    },
  };
}

async function loadLegacySamples(): Promise<{ winners: Sample[]; losers: Sample[] }> {
  const { data, error } = await supabase
    .from('alerts')
    .select('token_address,alerted_at,score_at_alert,alert_price,high_price_after_alert,liquidity_at_alert,volume5m_at_alert,buys5m_at_alert,sells5m_at_alert')
    .not('alert_price', 'is', null)
    .not('high_price_after_alert', 'is', null)
    .order('alerted_at', { ascending: true })
    .limit(5000);
  if (error) throw error;

  // One earliest measured alert per contract prevents a noisy token from dominating the learner.
  const firstByToken = new Map<string, LegacyAlert>();
  for (const row of (data ?? []) as LegacyAlert[]) {
    if (!row.token_address) continue;
    const key = row.token_address.toLowerCase();
    if (!firstByToken.has(key)) firstByToken.set(key, row);
  }

  const samples: Sample[] = [];
  for (const row of firstByToken.values()) {
    const entry = finite(row.alert_price);
    const high = finite(row.high_price_after_alert);
    if (entry == null || high == null || entry <= 0 || high <= 0) continue;
    const sells = finite(row.sells5m_at_alert);
    const buys = finite(row.buys5m_at_alert);
    samples.push({
      ...row,
      multiple: high / entry,
      buySellRatio: sells != null && sells > 0 && buys != null ? buys / sells : null,
    });
  }
  return {
    winners: samples.filter(sample => sample.multiple >= 3),
    losers: samples.filter(sample => sample.multiple < 1.2),
  };
}

async function loadRobinhoodStructureRecommendation(): Promise<Recommendation[]> {
  const [{ data: outcomes, error: outcomeError }, { data: snapshots, error: snapshotError }] = await Promise.all([
    supabase.from('pons_token_outcomes')
      .select('token_address,first_market_cap,peak_market_cap')
      .not('first_market_cap', 'is', null)
      .not('peak_market_cap', 'is', null)
      .limit(3000),
    supabase.from('robinhood_dex_paid_security_snapshots')
      .select('token_address,evaluated_at,bundle_level,bundle_score,bundle_evidence_available,dev_holding_percent,dev_movement_status,dev_moved_percent,holder_risk,holder_top1_pct')
      .order('evaluated_at', { ascending: false })
      .limit(5000),
  ]);
  if (outcomeError) throw outcomeError;
  if (snapshotError) throw snapshotError;

  const latestSecurity = new Map<string, any>();
  for (const row of snapshots ?? []) {
    const key = String(row.token_address ?? '').toLowerCase();
    if (key && !latestSecurity.has(key)) latestSecurity.set(key, row);
  }
  const winnerSecurity: any[] = [];
  const loserSecurity: any[] = [];
  for (const row of outcomes ?? []) {
    const first = finite(row.first_market_cap);
    const peak = finite(row.peak_market_cap);
    if (first == null || peak == null || first <= 0) continue;
    const security = latestSecurity.get(String(row.token_address ?? '').toLowerCase());
    if (!security) continue;
    const multiple = peak / first;
    if (multiple >= 3) winnerSecurity.push(security);
    else if (multiple < 1.2) loserSecurity.push(security);
  }

  const make = (factorKey: string, title: string, predicate: (row: any) => boolean): Recommendation => {
    const winnerHit = winnerSecurity.filter(predicate).length;
    const loserHit = loserSecurity.filter(predicate).length;
    const winnerRate = winnerSecurity.length ? winnerHit / winnerSecurity.length : 0;
    const loserRate = loserSecurity.length ? loserHit / loserSecurity.length : 0;
    const lift = loserRate > 0 ? winnerRate / loserRate : winnerRate > 0 ? 99 : 1;
    const enough = winnerSecurity.length >= MIN_MEASURED_SIDE && loserSecurity.length >= MIN_MEASURED_SIDE;
    const emerging = winnerSecurity.length >= MIN_EMERGING_SIDE && loserSecurity.length >= MIN_EMERGING_SIDE;
    return {
      scope: 'ROBINHOOD_STRUCTURE', factorKey,
      direction: enough && lift >= 1.35 ? 'INCREASE_WEIGHT' : enough && lift <= 0.75 ? 'DECREASE_WEIGHT' : 'OBSERVE_MORE',
      title,
      rationale: enough
        ? `Observed in ${(winnerRate * 100).toFixed(1)}% of measured winners vs ${(loserRate * 100).toFixed(1)}% of measured losers (lift ${lift.toFixed(2)}x).`
        : 'Robinhood outcome coverage is still too small to promote this structure pattern; continue measuring.',
      winnerSampleSize: winnerSecurity.length, loserSampleSize: loserSecurity.length,
      effectSize: Number.isFinite(lift) ? Number(lift.toFixed(4)) : null,
      confidence: emerging ? confidenceFromSamples(winnerSecurity.length, loserSecurity.length, lift - 1) : null,
      evidence: { winnerHit, loserHit, winnerRate, loserRate, lift, minimumMeasuredSide: MIN_MEASURED_SIDE },
    };
  };

  return [
    make('bundle_clean', 'Clean bundle structure', row => row.bundle_evidence_available === true && String(row.bundle_level ?? '').toUpperCase() === 'LOW'),
    make('holder_clean', 'Low holder concentration risk', row => String(row.holder_risk ?? '').toUpperCase() === 'LOW'),
    make('dev_not_moving', 'Developer not distributing into launch', row => ['NONE','CLEAN','NO_MOVEMENT'].includes(String(row.dev_movement_status ?? '').toUpperCase()) || finite(row.dev_moved_percent) === 0),
    make('dev_holding_controlled', 'Controlled developer holding', row => { const v = finite(row.dev_holding_percent); return v != null && v <= 10; }),
  ];
}

async function persist(recommendations: Recommendation[]): Promise<void> {
  for (const item of recommendations) {
    const row = {
      scope: item.scope,
      factor_key: item.factorKey,
      direction: item.direction,
      title: item.title,
      rationale: item.rationale,
      winner_sample_size: item.winnerSampleSize,
      loser_sample_size: item.loserSampleSize,
      effect_size: item.effectSize,
      confidence: item.confidence,
      evidence: item.evidence,
      status: 'SHADOW',
      generated_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + RUN_INTERVAL_MS * 2).toISOString(),
    };
    const { error } = await supabase.from('learning_recommendations')
      .upsert(row, { onConflict: 'scope,factor_key,direction,status' });
    if (error) throw error;
  }
}

export async function runOutcomePatternLearner(): Promise<void> {
  const legacy = await loadLegacySamples();
  const recommendations: Recommendation[] = [
    recommendationForBinaryFactor({ scope: 'LEGACY_MARKET', factorKey: 'buy_sell_ratio_1_8', title: 'Strong buy pressure', winners: legacy.winners, losers: legacy.losers, predicate: sample => sample.buySellRatio != null && sample.buySellRatio >= 1.8 }),
    recommendationForBinaryFactor({ scope: 'LEGACY_MARKET', factorKey: 'liquidity_8k_30k', title: 'Liquidity sweet spot $8K–$30K', winners: legacy.winners, losers: legacy.losers, predicate: sample => { const v = finite(sample.liquidity_at_alert); return v != null && v >= 8_000 && v <= 30_000; } }),
    recommendationForBinaryFactor({ scope: 'LEGACY_MARKET', factorKey: 'volume_8k_plus', title: '5m volume above $8K', winners: legacy.winners, losers: legacy.losers, predicate: sample => { const v = finite(sample.volume5m_at_alert); return v != null && v >= 8_000; } }),
    recommendationForBinaryFactor({ scope: 'LEGACY_MARKET', factorKey: 'score_82_plus', title: 'Current HIGH_BUY score threshold', winners: legacy.winners, losers: legacy.losers, predicate: sample => { const v = finite(sample.score_at_alert); return v != null && v >= 82; } }),
    ...(await loadRobinhoodStructureRecommendation()),
  ];
  await persist(recommendations);
  console.log('[OutcomePatternLearner] refreshed', {
    legacyWinners: legacy.winners.length,
    legacyLosers: legacy.losers.length,
    recommendations: recommendations.length,
    promotionChangesApplied: 0,
  });
}

let started = false;
export function startOutcomePatternLearner(): void {
  if (started) return;
  started = true;
  console.log('[OutcomePatternLearner] Started. Shadow recommendations only; production scoring unchanged.');
  void runOutcomePatternLearner().catch(error => console.warn('[OutcomePatternLearner] initial run failed', error instanceof Error ? error.message : String(error)));
  setInterval(() => void runOutcomePatternLearner().catch(error => console.warn('[OutcomePatternLearner] refresh failed', error instanceof Error ? error.message : String(error))), RUN_INTERVAL_MS);
}
