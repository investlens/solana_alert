import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
import { enrichTokenByMintAddress } from './dexscreener.js';
import { supabase } from './supabase.js';

export const ALPHA_OUTCOME_CHECKPOINTS = [30, 60, 180, 300, 900, 1800, 3600] as const;
export const OUTCOME_ELIGIBLE_SEMANTIC_TYPES = ['DEX_PAID', 'BOOST', 'VOLUME_SURGE', 'DEV_BURN', 'DEV_SELL', 'LIQUIDITY_RISK'] as const;
export const OUTCOME_ELIGIBLE_ALERT_TYPES = ['ENTRY', 'CHECK_ENTRY', 'OPPORTUNITY'] as const;
type EventRow = { id: number; asset_id: string; chain: string; price: number | string | null; alerted_at: string; semantic_event_type?: string | null; alert_type?: string | null };
type PriorRow = { current_price: number | string | null; peak_price: number | string | null; peak_roi: number | string | null; time_to_peak_seconds: number | null };
const positive = (value: unknown): number | null => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; };

export function buildAlphaOutcomeCheckpoint(args: {
  event: EventRow; checkpointSeconds: number; currentPrice: number | null;
  source: string | null; provenance: string | null; prior: PriorRow[]; measuredAt?: string;
  unavailableReason?: string | null;
}) {
  const measuredAt = args.measuredAt ?? new Date().toISOString();
  const entry = positive(args.event.price); const current = positive(args.currentPrice);
  const previousPrices = args.prior.flatMap(row => [positive(row.current_price), positive(row.peak_price)]).filter((v): v is number => v != null);
  if (entry == null || current == null) return {
    alert_event_id: args.event.id, checkpoint_seconds: args.checkpointSeconds,
    current_roi: null, peak_roi: null, time_to_peak_seconds: null, max_drawdown: null,
    current_price: current, peak_price: previousPrices.length ? Math.max(...previousPrices) : null,
    measurement_source: args.source, price_provenance: args.provenance, measured_at: measuredAt,
    status: 'UNAVAILABLE', completeness: { entryPrice: entry != null, currentPrice: current != null,
      reason: entry == null ? 'MISSING_ENTRY_PRICE' : (args.unavailableReason ?? 'MISSING_CURRENT_PRICE') },
  };
  const peak = Math.max(entry, current, ...previousPrices);
  const currentRoi = ((current - entry) / entry) * 100; const peakRoi = ((peak - entry) / entry) * 100;
  const priorPeak = args.prior.find(row => positive(row.peak_price) === peak);
  return {
    alert_event_id: args.event.id, checkpoint_seconds: args.checkpointSeconds,
    current_roi: currentRoi, peak_roi: peakRoi,
    time_to_peak_seconds: current === peak ? args.checkpointSeconds : priorPeak?.time_to_peak_seconds ?? null,
    max_drawdown: ((peak - current) / peak) * 100, current_price: current, peak_price: peak,
    measurement_source: args.source, price_provenance: args.provenance, measured_at: measuredAt,
    status: 'MEASURED', completeness: { entryPrice: true, currentPrice: true, peakPrice: true },
  };
}

async function currentPrice(event: EventRow): Promise<{ price: number | null; source: string | null; provenance: string | null; reason: string | null }> {
  if (['robinhood', 'pons'].includes(event.chain.toLowerCase())) {
    const market = await getRobinhoodMarketSnapshot(event.asset_id);
    return { price: market?.priceUsd ?? null, source: market ? 'ROBINHOOD_MARKET_SNAPSHOT' : null, provenance: market ? 'DEXSCREENER_VERIFIED_BASE_PAIR' : null, reason: market ? null : 'ROBINHOOD_MARKET_UNAVAILABLE' };
  }
  if (event.chain.toLowerCase() === 'solana') {
    const result = await enrichTokenByMintAddress(event.asset_id);
    const pair = result?.pair as { priceUsd?: string | null } | undefined;
    return { price: positive(pair?.priceUsd), source: pair ? 'DEXSCREENER_TOKEN_PAIR' : null, provenance: pair ? 'DEX_BASE_V1' : null, reason: pair ? null : 'SOLANA_MARKET_UNAVAILABLE' };
  }
  return { price: null, source: null, provenance: null, reason: 'UNSUPPORTED_CHAIN' };
}

export function premiumEventNeedsOutcome(event: Pick<EventRow, 'semantic_event_type' | 'alert_type'>): boolean {
  return (OUTCOME_ELIGIBLE_SEMANTIC_TYPES as readonly string[]).includes(String(event.semantic_event_type ?? '').toUpperCase()) ||
    (OUTCOME_ELIGIBLE_ALERT_TYPES as readonly string[]).includes(String(event.alert_type ?? '').toUpperCase());
}

export function selectOutcomeEligibleCandidates(events: EventRow[], limit = 200): EventRow[] {
  return events.filter(premiumEventNeedsOutcome).slice(0, limit);
}

export function checkpointCanUseCurrentPrice(ageSeconds: number, checkpointSeconds: number, maximumLatenessSeconds = 60): boolean {
  return ageSeconds >= checkpointSeconds && ageSeconds - checkpointSeconds <= maximumLatenessSeconds;
}

export async function runAlphaOutcomeCheckpointCycle(now = new Date()): Promise<number> {
  const started = Date.now();
  const oldest = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const latest = new Date(now.getTime() - 30_000).toISOString();
  const { data, error } = await supabase.rpc('select_alpha_outcome_candidates', {
    p_oldest: oldest, p_latest: latest, p_now: now.toISOString(), p_limit: 200,
  });
  if (error) throw error;
  let inserted = 0, attempted = 0, measured = 0, unavailable = 0, failed = 0;
  for (const event of (data ?? []) as EventRow[]) {
    const ageSeconds = Math.floor((now.getTime() - new Date(event.alerted_at).getTime()) / 1000);
    const { data: existing, error: existingError } = await supabase.from('alpha_alert_outcomes')
      .select('checkpoint_seconds,current_price,peak_price,peak_roi,time_to_peak_seconds').eq('alert_event_id', event.id);
    if (existingError) throw existingError;
    const done = new Set((existing ?? []).map(row => Number(row.checkpoint_seconds)));
    const due = ALPHA_OUTCOME_CHECKPOINTS.find(seconds => ageSeconds >= seconds && !done.has(seconds));
    if (!due) continue;
    attempted += 1;
    let measurement = { price: null as number | null, source: null as string | null, provenance: null as string | null,
      reason: 'HISTORICAL_CHECKPOINT_PRICE_UNAVAILABLE' as string | null };
    if (checkpointCanUseCurrentPrice(ageSeconds, due)) {
      measurement.reason = 'PRICE_ACQUISITION_FAILED';
      try { measurement = await currentPrice(event); } catch { /* persist unavailable; never synthesize */ }
    }
    const row = buildAlphaOutcomeCheckpoint({ event, checkpointSeconds: due, currentPrice: measurement.price, source: measurement.source, provenance: measurement.provenance, prior: (existing ?? []) as PriorRow[], measuredAt: now.toISOString(), unavailableReason: measurement.reason });
    const { error: insertError } = await supabase.from('alpha_alert_outcomes').upsert(row, { onConflict: 'alert_event_id,checkpoint_seconds', ignoreDuplicates: true });
    if (insertError) { failed += 1; console.warn('[AlphaOutcomeCheckpoints] Checkpoint persistence failed', { alertEventId: event.id,
      checkpointSeconds: due, reason: insertError.message }); continue; }
    inserted += 1; if (row.status === 'MEASURED') measured += 1; else unavailable += 1;
  }
  console.log('alpha_outcome_checkpoint_cycle', { eligible_candidates: data?.length ?? 0, selected: data?.length ?? 0,
    checkpoints_attempted: attempted, measured, unavailable, failed, duration_ms: Date.now() - started });
  return inserted;
}

let started = false;
export function startAlphaOutcomeCheckpointService(): void {
  if (started) return; started = true;
  const run = () => void runAlphaOutcomeCheckpointCycle().catch(error => console.warn('[AlphaOutcomeCheckpoints] Cycle failed:', error));
  run(); setInterval(run, Number(process.env.ALPHA_OUTCOME_CHECKPOINT_POLL_MS ?? 15_000));
}
