import { supabase } from '../../services/supabase.js';
import { runDatabaseWork } from '../../services/databaseLoadGovernor.js';

type RobinhoodCreatorObservation = {
  token_address: string;
  symbol: string | null;
  name: string | null;
  deployer_address: string | null;
  first_seen_at: string | null;
  decision_at: string | null;
  market_cap_at_decision: number | null;
  roi_high_percent: number | null;
  current_market_cap: number | null;
  peak_market_cap: number | null;
  roi_1m_percent: number | null;
  roi_3m_percent: number | null;
  roi_5m_percent: number | null;
  roi_15m_percent: number | null;
};

type CreatorLaunchComparable = {
  token: string;
  creator_wallet: string | null;
  symbol: string | null;
  name: string | null;
  initial_market_cap: number | null;
  current_market_cap: number | null;
  peak_market_cap: number | null;
  crossed_50k: boolean | null;
  crossed_100k: boolean | null;
  crossed_250k: boolean | null;
  crossed_500k: boolean | null;
  crossed_1m: boolean | null;
  severe_crash: boolean | null;
  catastrophic_crash: boolean | null;
  return_5m_pct: number | null;
  return_15m_pct: number | null;
};

const OBSERVATION_LIMIT = 500;
const UPSERT_BATCH_SIZE = 100;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nullableNumber(value: unknown): number | null {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? n : null;
}

function getWorstEarlyReturn(row: RobinhoodCreatorObservation): number | null {
  const values = [row.roi_1m_percent, row.roi_3m_percent, row.roi_5m_percent, row.roi_15m_percent]
    .filter((value): value is number => value != null && Number.isFinite(Number(value)))
    .map(Number);
  return values.length ? Math.min(...values) : null;
}

function sameNumber(a: unknown, b: unknown): boolean {
  const left = nullableNumber(a), right = nullableNumber(b);
  if (left == null || right == null) return left === right;
  return Math.abs(left - right) <= Math.max(0.01, Math.abs(left) * 0.0001);
}

function materiallyChanged(existing: CreatorLaunchComparable | undefined, desired: Record<string, unknown>): boolean {
  if (!existing) return true;
  for (const key of ['creator_wallet', 'symbol', 'name', 'crossed_50k', 'crossed_100k', 'crossed_250k', 'crossed_500k', 'crossed_1m', 'severe_crash', 'catastrophic_crash'] as const) {
    if ((existing[key] ?? null) !== (desired[key] ?? null)) return true;
  }
  for (const key of ['initial_market_cap', 'current_market_cap', 'peak_market_cap', 'return_5m_pct', 'return_15m_pct'] as const) {
    if (!sameNumber(existing[key], desired[key])) return true;
  }
  return false;
}

function buildLaunch(row: RobinhoodCreatorObservation, checkedAt: string) {
  const initialMarketCap = num(row.market_cap_at_decision);
  const currentMarketCap = num(row.current_market_cap);
  const peakRoi = num(row.roi_high_percent);
  const estimatedHistoricalPeakMarketCap = initialMarketCap > 0 && peakRoi > 0
    ? initialMarketCap * (1 + peakRoi / 100) : 0;
  const peakMarketCap = Math.max(num(row.peak_market_cap), estimatedHistoricalPeakMarketCap, initialMarketCap, currentMarketCap);
  const worstEarlyReturn = getWorstEarlyReturn(row);
  return {
    chain: 'robinhood',
    creator_wallet: row.deployer_address!.toLowerCase(),
    token: row.token_address.toLowerCase(),
    symbol: row.symbol ?? null,
    name: row.name ?? null,
    initial_market_cap: initialMarketCap || null,
    alert_market_cap: initialMarketCap || null,
    current_market_cap: currentMarketCap || null,
    peak_market_cap: peakMarketCap || null,
    launched_at: row.first_seen_at ?? row.decision_at ?? checkedAt,
    last_checked_at: checkedAt,
    crossed_50k: peakMarketCap >= 50_000,
    crossed_100k: peakMarketCap >= 100_000,
    crossed_250k: peakMarketCap >= 250_000,
    crossed_500k: peakMarketCap >= 500_000,
    crossed_1m: peakMarketCap >= 1_000_000,
    severe_crash: worstEarlyReturn != null && worstEarlyReturn <= -80,
    catastrophic_crash: worstEarlyReturn != null && worstEarlyReturn <= -90,
    return_5m_pct: row.roi_5m_percent ?? null,
    return_15m_pct: row.roi_15m_percent ?? null,
    max_return_pct: initialMarketCap > 0 ? ((peakMarketCap - initialMarketCap) / initialMarketCap) * 100 : null,
    tracking_complete: false,
  };
}

async function syncCreatorIntelligenceOnce(): Promise<void> {
  const { data, error } = await supabase
    .from('robinhood_observations')
    .select('token_address,symbol,name,deployer_address,first_seen_at,decision_at,market_cap_at_decision,current_market_cap,peak_market_cap,roi_1m_percent,roi_3m_percent,roi_5m_percent,roi_15m_percent,roi_high_percent')
    .not('deployer_address', 'is', null)
    .order('decision_at', { ascending: false })
    .limit(OBSERVATION_LIMIT);
  if (error) throw error;

  const rows = (data ?? []) as unknown as RobinhoodCreatorObservation[];
  const valid = rows.filter(row => row.deployer_address && row.token_address);
  if (!valid.length) return;

  const checkedAt = new Date().toISOString();
  const desired = valid.map(row => buildLaunch(row, checkedAt));
  const tokens = [...new Set(desired.map(row => row.token))];
  const { data: existingRows, error: existingError } = await supabase
    .from('creator_launches')
    .select('token,creator_wallet,symbol,name,initial_market_cap,current_market_cap,peak_market_cap,crossed_50k,crossed_100k,crossed_250k,crossed_500k,crossed_1m,severe_crash,catastrophic_crash,return_5m_pct,return_15m_pct')
    .eq('chain', 'robinhood')
    .in('token', tokens);
  if (existingError) throw existingError;

  const existing = new Map<string, CreatorLaunchComparable>(
    ((existingRows ?? []) as unknown as CreatorLaunchComparable[]).map(row => [row.token.toLowerCase(), row]),
  );
  const changed = desired.filter(row => materiallyChanged(existing.get(row.token), row));

  let synced = 0;
  for (let offset = 0; offset < changed.length; offset += UPSERT_BATCH_SIZE) {
    const batch = changed.slice(offset, offset + UPSERT_BATCH_SIZE);
    const { error: launchError } = await supabase.from('creator_launches').upsert(batch, { onConflict: 'chain,token' });
    if (launchError) throw launchError;
    synced += batch.length;
  }

  console.log('[RobinhoodCreatorIntel] Sync complete:', { observations: rows.length, candidates: desired.length, changed: changed.length, synced });
}

export async function syncRobinhoodCreatorIntelligence(): Promise<void> {
  try {
    const result = await runDatabaseWork('BACKGROUND', syncCreatorIntelligenceOnce);
    if (result === null) console.log('[RobinhoodCreatorIntel] Skipped while database governor is protecting critical work.');
  } catch (error) {
    console.error('[RobinhoodCreatorIntel] Sync failed:', error instanceof Error ? error.message : String(error));
  }
}
