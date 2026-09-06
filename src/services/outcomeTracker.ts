import { supabase } from "./supabase.js";
import { governedDexScreenerJson } from './dexscreenerRequestGovernor.js';
import { publishOutcomeStatus, type OutcomeStatus } from "./outcomeService.js";
import { runDatabaseWork } from './databaseLoadGovernor.js';

const TRACK_INTERVAL_MS = 10 * 60_000;
const REQUEST_DELAY_MS = 250;
const ACTIVE_MAX_AGE_HOURS = 24;
const RUG_THRESHOLD_PERCENT = -90;
const CYCLE_LIMIT = 50;

type OutcomeRow = {
  id: string; alert_id: string; chain: string | null; token_address: string; pair_address: string | null; symbol: string | null;
  entry_price: number | string; current_price: number | string; highest_price: number | string; lowest_price: number | string;
  roi_current: number | string | null; roi_peak: number | string | null; roi_low: number | string | null; max_drawdown: number | string | null;
  status: string; alerted_at: string; highest_price_at: string | null; lowest_price_at: string | null; last_checked_at: string | null;
};
type DexPair = { priceUsd?: string | null };
type DexPairResponse = { pairs?: DexPair[] | null };

let trackerStarted = false;
let trackingCycleRunning = false;
const toNumber = (value: number | string | null | undefined) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const calculateRoi = (entryPrice: number, price: number) => entryPrice > 0 ? ((price - entryPrice) / entryPrice) * 100 : 0;
const calculateDrawdown = (highestPrice: number, currentPrice: number) => highestPrice > 0 ? ((highestPrice - currentPrice) / highestPrice) * 100 : 0;
const getAgeHours = (alertedAt: string) => (Date.now() - new Date(alertedAt).getTime()) / 3_600_000;

async function fetchLatestPairPrice(chain: string, pairAddress: string): Promise<number | null> {
  const url = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pairAddress)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const payload = (await governedDexScreenerJson<DexPairResponse>({
      url, caller: 'legacy_outcome_tracker', priority: 'BACKGROUND', endpoint: 'PAIR_PRICE',
      cacheKey: `pair:${chain.toLowerCase()}:${pairAddress.toLowerCase()}`, cacheTtlMs: 30_000, signal: controller.signal,
    })).value;
    const price = Number(payload.pairs?.[0]?.priceUsd);
    return Number.isFinite(price) && price > 0 ? price : null;
  } finally { clearTimeout(timeout); }
}

async function completeOutcome(outcome: OutcomeRow, status: "COMPLETED" | "RUGGED" | "DEAD" | "EXPIRED", nowIso: string): Promise<void> {
  const { error } = await supabase.from("alert_outcomes").update({ status, completed_at: nowIso, last_checked_at: nowIso, updated_at: nowIso }).eq("id", outcome.id);
  if (error) throw new Error(`Failed to complete ${outcome.symbol ?? outcome.id}: ${error.message}`);
  await publishOutcomeStatus({ alertId: outcome.alert_id, chain: outcome.chain ?? "solana", tokenAddress: outcome.token_address,
    symbol: outcome.symbol, previousStatus: outcome.status as OutcomeStatus, nextStatus: status,
    roiCurrent: toNumber(outcome.roi_current), roiPeak: toNumber(outcome.roi_peak), maxDrawdown: toNumber(outcome.max_drawdown) });
}

async function updateOutcome(outcome: OutcomeRow): Promise<void> {
  const symbol = outcome.symbol ?? outcome.token_address.slice(0, 8);
  const chain = outcome.chain || "solana";
  const nowIso = new Date().toISOString();
  if (!outcome.pair_address) { await completeOutcome(outcome, "DEAD", nowIso); return; }
  if (getAgeHours(outcome.alerted_at) >= ACTIVE_MAX_AGE_HOURS) { await completeOutcome(outcome, "COMPLETED", nowIso); return; }
  const latestPrice = await fetchLatestPairPrice(chain, outcome.pair_address);
  if (latestPrice === null) return;
  const entryPrice = toNumber(outcome.entry_price);
  if (entryPrice <= 0) { await completeOutcome(outcome, "DEAD", nowIso); return; }
  const storedHighest = toNumber(outcome.highest_price), storedLowest = toNumber(outcome.lowest_price);
  const nextHighest = Math.max(entryPrice, storedHighest, latestPrice);
  const nextLowest = Math.min(entryPrice, storedLowest > 0 ? storedLowest : entryPrice, latestPrice);
  const roiCurrent = calculateRoi(entryPrice, latestPrice), roiPeak = calculateRoi(entryPrice, nextHighest);
  const roiLow = calculateRoi(entryPrice, nextLowest), maxDrawdown = calculateDrawdown(nextHighest, latestPrice);
  const nextStatus = roiCurrent <= RUG_THRESHOLD_PERCENT ? "RUGGED" : "ACTIVE";
  const updatePayload: Record<string, unknown> = { current_price: latestPrice, highest_price: nextHighest, lowest_price: nextLowest,
    roi_current: roiCurrent, roi_peak: roiPeak, roi_low: roiLow, max_drawdown: maxDrawdown, status: nextStatus,
    last_checked_at: nowIso, updated_at: nowIso };
  if (latestPrice > storedHighest) updatePayload.highest_price_at = nowIso;
  if (storedLowest <= 0 || latestPrice < storedLowest) updatePayload.lowest_price_at = nowIso;
  if (nextStatus === "RUGGED") updatePayload.completed_at = nowIso;
  const { error } = await supabase.from("alert_outcomes").update(updatePayload).eq("id", outcome.id);
  if (error) throw new Error(`Failed to update ${symbol}: ${error.message}`);
  if (nextStatus === "RUGGED") await publishOutcomeStatus({ alertId: outcome.alert_id, chain, tokenAddress: outcome.token_address,
    symbol: outcome.symbol, previousStatus: outcome.status as OutcomeStatus, nextStatus, roiCurrent, roiPeak, maxDrawdown });
}

async function runOutcomeTrackingDatabaseWork(): Promise<void> {
  const { data, error } = await supabase.from("alert_outcomes").select(`
    id,alert_id,chain,token_address,pair_address,symbol,entry_price,current_price,highest_price,lowest_price,
    roi_current,roi_peak,roi_low,max_drawdown,status,alerted_at,highest_price_at,lowest_price_at,last_checked_at
  `).eq("status", "ACTIVE").order("last_checked_at", { ascending: true, nullsFirst: true }).limit(CYCLE_LIMIT);
  if (error) throw new Error(`Unable to load active outcomes: ${error.message}`);
  for (const outcome of (data ?? []) as OutcomeRow[]) { await updateOutcome(outcome); await sleep(REQUEST_DELAY_MS); }
}

export async function runOutcomeTrackingCycle(): Promise<void> {
  if (trackingCycleRunning) return;
  trackingCycleRunning = true;
  try { await runDatabaseWork("BACKGROUND", runOutcomeTrackingDatabaseWork); }
  catch (error) { console.error(`[OutcomeTracker] Cycle failed: ${error instanceof Error ? error.message : String(error)}`); }
  finally { trackingCycleRunning = false; }
}

export function startOutcomeTracker(): void {
  if (trackerStarted) return;
  trackerStarted = true;
  if (process.env.LEGACY_OUTCOME_TRACKER_ENABLED !== 'true') {
    console.log('[OutcomeTracker] Legacy broad tracker disabled; semantic checkpoint tracker is authoritative.');
    return;
  }
  console.log(`[OutcomeTracker] Legacy tracker enabled. Interval: ${TRACK_INTERVAL_MS / 1000} seconds.`);
  setInterval(() => void runOutcomeTrackingCycle(), TRACK_INTERVAL_MS);
}
