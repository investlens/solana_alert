import { config } from '../../config.js';
import { recordOpportunity } from '../../core/opportunityRegistry.js';
import { assessTokenIntelligence, type IntelligenceObservation, type TokenIntelligenceState } from '../../intelligence/tokenIntelligenceState.js';
import { recordOpportunityAndEmit } from '../../services/opportunityService.js';
import { qualifyPremiumOpportunity } from '../../services/opportunityDeliveryService.js';
import { runDatabaseWork } from '../../services/databaseLoadGovernor.js';
import { supabase } from '../../services/supabase.js';
import { getRobinhoodMarketSnapshot } from './market.js';
import { DexScreenerHttpTimeoutError, DexScreenerMalformedResponseError, DexScreenerProviderHttpError,
  DexScreenerQueueCapacityError, getDexScreenerBackoffState, isDexScreenerProviderBackoffError,
  recordDexScreenerCallerOutcome } from '../../services/dexscreenerRequestGovernor.js';

export type ExistingTokenTier = 'HOT' | 'WARM';
export type ExistingTokenScanResultCode = 'DEFERRED_QUEUE_CAPACITY' | 'CYCLE_BUDGET_DEFERRED' |
  'HTTP_TIMEOUT' | 'PROVIDER_HTTP_ERROR' | 'RATE_LIMITED' | 'NO_USABLE_PAIR' | 'MALFORMED_RESPONSE';
export type ExistingTokenUniverseEntry = { token: string; tier: ExistingTokenTier; lastSeenAt: string; watched?: boolean };
export type ExistingTokenMonitorData = { state?: TokenIntelligenceState; intelligenceState?: TokenIntelligenceState; observations?: IntelligenceObservation[]; peakMarketCap?: number | null; lastAlertState?: TokenIntelligenceState | null; lastAlertAt?: string | null };
type UniverseRow = { asset_id?: string | null; token_address?: string | null; alerted_at?: string | null; created_at?: string | null; updated_at?: string | null; last_observed_at?: string | null; status?: string | null; strategy_key?: string | null; opportunities?: { asset_id?: string | null; chain?: string | null } | null };

const SCANNER_TICK_MS = 15_000;
const UNIVERSE_REFRESH_MS = 60_000;
const MAX_UNIVERSE_ROWS_PER_SOURCE = 100;
const MAX_HISTORY = 12;
const MAX_CONCURRENCY = 3;
const CYCLE_BUDGET_MS = 20_000;
const MEANINGFUL_EVENT_TYPES = ['DEX_PAID', 'BOOST', 'REIGNITION', 'TREND_REVERSAL', 'PONS_PROVEN_DEV_LAUNCH', 'PROVEN_DEV_LAUNCH'];
export const EXISTING_TOKEN_SCANNER_QUEUE_WAIT_MS = 10_000;
export const EXISTING_TOKEN_SCANNER_SUSTAINABLE_QUOTA = 6;
let scannerStarted = false;
let scannerRunning = false;
let scannerTimer: ReturnType<typeof setInterval> | null = null;
let hotCursor = 0;
let warmCursor = 0;
let cachedUniverse: ExistingTokenUniverseEntry[] = [];
let lastUniverseRefreshAt = 0;
const lastScannedAt = new Map<string, number>();

export function recordCompletedExistingTokenScans(entries: ExistingTokenUniverseEntry[], scannedAt = Date.now()) {
  for (const entry of entries) lastScannedAt.set(normalize(entry.token), scannedAt);
}

export function existingTokenLastScannedAtForTests(token: string) { return lastScannedAt.get(normalize(token)) ?? null; }
export function resetExistingTokenLastScannedAtForTests() { lastScannedAt.clear(); }

export function requirePersistedScannerOpportunity<T>(value: T | null, strategyKey: string): T {
  if (value == null) throw new Error(`scanner persistence failed for ${strategyKey}`);
  return value;
}

const normalize = (value: string) => value.trim().toLowerCase();
const rowTime = (row: UniverseRow) => row.last_observed_at ?? row.alerted_at ?? row.updated_at ?? row.created_at ?? new Date(0).toISOString();
const finitePositive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export class ExistingTokenNoUsablePairError extends Error {
  readonly code = 'NO_USABLE_PAIR';
  constructor() { super('completed DexScreener lookup returned no usable verified pair'); this.name = 'ExistingTokenNoUsablePairError'; }
}

export function existingTokenObservationIsSeparated(observations: IntelligenceObservation[] | undefined, observedAt: string, minimumSeconds: number) {
  const previousAt = Date.parse(observations?.[observations.length - 1]?.observedAt ?? '');
  const currentAt = Date.parse(observedAt);
  return !Number.isFinite(previousAt) || (Number.isFinite(currentAt) && currentAt - previousAt >= minimumSeconds * 1000);
}

export function existingTokenPersistedState(prior: ExistingTokenMonitorData): TokenIntelligenceState {
  return prior.state ?? prior.intelligenceState ?? 'DISCOVERED';
}

export function buildExistingTokenUniverse(args: { now?: number; opportunities?: UniverseRow[]; observations?: UniverseRow[]; events?: UniverseRow[]; wallet?: UniverseRow[]; watched?: UniverseRow[]; retentionHours?: number }): ExistingTokenUniverseEntry[] {
  const now = args.now ?? Date.now();
  const cutoff = now - (args.retentionHours ?? config.existingTokenRetentionHours) * 3_600_000;
  const merged = new Map<string, ExistingTokenUniverseEntry>();
  const add = (row: UniverseRow, tier: ExistingTokenTier, watched = false) => {
    const raw = row.asset_id ?? row.token_address ?? row.opportunities?.asset_id;
    if (!raw || (row.opportunities?.chain && row.opportunities.chain !== 'robinhood')) return;
    const token = normalize(raw); const seen = Date.parse(rowTime(row));
    const extended = watched || (['NEW', 'WATCHING', 'APPROVED'].includes(String(row.status ?? '').toUpperCase()) &&
      ['EXISTING_TOKEN_MONITOR', 'EXISTING_TOKEN_REIGNITION', 'EXISTING_TOKEN_BREAKOUT', 'EXISTING_TOKEN_RUNNER'].includes(String(row.strategy_key ?? '').toUpperCase()));
    if (!extended && (!Number.isFinite(seen) || seen < cutoff)) return;
    const prior = merged.get(token);
    merged.set(token, { token, tier: prior?.tier === 'HOT' || tier === 'HOT' ? 'HOT' : 'WARM',
      lastSeenAt: new Date(Math.max(Number.isFinite(seen) ? seen : 0, Date.parse(prior?.lastSeenAt ?? '') || 0)).toISOString(), watched: prior?.watched || watched });
  };
  args.observations?.forEach(row => add(row, 'WARM'));
  args.events?.forEach(row => add(row, 'HOT'));
  args.wallet?.forEach(row => add(row, 'HOT'));
  args.opportunities?.forEach(row => add(row, ['NEW', 'WATCHING', 'APPROVED'].includes(String(row.status).toUpperCase()) ? 'HOT' : 'WARM'));
  args.watched?.forEach(row => add(row, 'HOT', true));
  return [...merged.values()].sort((a, b) => a.tier === b.tier ? Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) : a.tier === 'HOT' ? -1 : 1);
}

export function selectDueExistingTokens(universe: ExistingTokenUniverseEntry[], args: { now?: number; max?: number; lastScanned?: Map<string, number>; hotStart?: number; warmStart?: number } = {}) {
  const now = args.now ?? Date.now(), history = args.lastScanned ?? lastScannedAt, max = args.max ?? config.existingTokenMaxPerCycle;
  const due = universe.filter(row => now - (history.get(row.token) ?? 0) >= (row.tier === 'HOT' ? config.existingTokenHotScanSeconds : config.existingTokenWarmScanSeconds) * 1000);
  const watched = due.filter(x => x.watched);
  const hot = due.filter(x => x.tier === 'HOT' && !x.watched); const warm = due.filter(x => x.tier === 'WARM' && !x.watched);
  const hotStart = hot.length ? (args.hotStart ?? hotCursor) % hot.length : 0;
  const warmStart = warm.length ? (args.warmStart ?? warmCursor) % warm.length : 0;
  const rotatedHot = [...hot.slice(hotStart), ...hot.slice(0, hotStart)];
  const rotatedWarm = [...warm.slice(warmStart), ...warm.slice(0, warmStart)];
  const watchedAllowance = Math.min(watched.length, max > 1 ? max - 1 : max);
  const priority = watched.slice(0, watchedAllowance); const remaining = Math.max(0, max - priority.length);
  const hotAllowance = warm.length && remaining > 1 ? remaining - 1 : remaining;
  const selected = [...priority, ...rotatedHot.slice(0, hotAllowance), ...rotatedWarm].slice(0, max);
  return { selected, dueCount: due.length,
    nextHotCursor: hot.length ? (hotStart + Math.max(1, selected.filter(x => x.tier === 'HOT' && !x.watched).length)) % hot.length : 0,
    nextWarmCursor: warm.length ? (warmStart + Math.max(1, selected.filter(x => x.tier === 'WARM').length)) % warm.length : 0 };
}

export function assessExistingTokenObservation(args: { prior: ExistingTokenMonitorData; observedAt: string; price: number; marketCap: number | null; liquidity: number | null; volume5m: number | null; buys5m: number | null; sells5m: number | null }) {
  const history = [...(args.prior.observations ?? []), { roi: 0, observedAt: args.observedAt, volume5m: args.volume5m, buys5m: args.buys5m, sells5m: args.sells5m, liquidity: args.liquidity }].slice(-MAX_HISTORY);
  const baseline = history.find(row => finitePositive((row as IntelligenceObservation & { price?: number }).price)) as (IntelligenceObservation & { price?: number }) | undefined;
  const previousPrice = finitePositive(baseline?.price) ?? args.price;
  history[history.length - 1] = { ...history[history.length - 1], roi: (args.price - previousPrice) / previousPrice * 100, price: args.price } as IntelligenceObservation;
  const previousState = existingTokenPersistedState(args.prior);
  const assessment = assessTokenIntelligence({ observations: history, priorState: previousState });
  const reentry = ['COOLING', 'WEAKENING'].includes(previousState) && ['BUILDING', 'CONFIRMED', 'RUNNER'].includes(assessment.state);
  const alertable = assessment.state === 'CONFIRMED' || assessment.state === 'RUNNER' || reentry;
  const transition = previousState !== assessment.state;
  return { history, assessment, previousState, reentry, alertable, transition,
    peakMarketCap: Math.max(args.prior.peakMarketCap ?? 0, args.marketCap ?? 0) || null };
}

async function loadUniverse() {
  const now = Date.now();
  if (cachedUniverse.length && now - lastUniverseRefreshAt < UNIVERSE_REFRESH_MS) return cachedUniverse;
  const cutoff = new Date(now - config.existingTokenRetentionHours * 3_600_000).toISOString();
  const loaded = await runDatabaseWork('BACKGROUND', async () => {
    const [opportunities, events, watched] = await Promise.all([
      supabase.from('opportunities').select('asset_id,status,strategy_key,last_observed_at,updated_at')
        .eq('chain', 'robinhood').in('status', ['NEW', 'WATCHING', 'APPROVED']).order('updated_at', { ascending: false }).limit(MAX_UNIVERSE_ROWS_PER_SOURCE),
      supabase.from('alpha_alert_events').select('asset_id,alerted_at,semantic_event_type').eq('chain', 'robinhood')
        .in('semantic_event_type', MEANINGFUL_EVENT_TYPES).gte('alerted_at', cutoff).order('alerted_at', { ascending: false }).limit(MAX_UNIVERSE_ROWS_PER_SOURCE),
      supabase.from('user_opportunity_watchlist').select('updated_at,opportunities(asset_id,chain)').limit(MAX_UNIVERSE_ROWS_PER_SOURCE),
    ]);
    for (const result of [opportunities, events, watched]) if (result.error) throw result.error;
    return buildExistingTokenUniverse({ opportunities: opportunities.data ?? [], events: events.data ?? [], watched: watched.data as unknown as UniverseRow[] ?? [] });
  });
  if (loaded === null) return cachedUniverse;
  cachedUniverse = loaded;
  lastUniverseRefreshAt = now;
  return cachedUniverse;
}

async function scanToken(entry: ExistingTokenUniverseEntry) {
  const { data: contexts, error } = await supabase.from('opportunities').select('strategy_key,raw_data').eq('chain', 'robinhood').eq('asset_id', entry.token).order('updated_at', { ascending: false }).limit(20);
  if (error) throw error;
  const monitor = contexts?.find(row => row.strategy_key === 'EXISTING_TOKEN_MONITOR');
  const prior = (monitor?.raw_data ?? {}) as ExistingTokenMonitorData;
  const existingRisk = (contexts ?? []).map(row => (row.raw_data ?? {}) as Record<string, unknown>)
    .find(raw => raw.confirmedDevSell === true || raw.criticalSecurity === true || raw.liquidityCritical === true) ?? {};
  const market = await getRobinhoodMarketSnapshot(entry.token, { priority: 'BACKGROUND', caller: 'existing_token_scanner', queueWaitTimeoutMs: EXISTING_TOKEN_SCANNER_QUEUE_WAIT_MS });
  if (!market) { recordDexScreenerCallerOutcome('existing_token_scanner', 'BACKGROUND', 'NO_USABLE_PAIR'); throw new ExistingTokenNoUsablePairError(); }
  const observedAt = new Date(market.timestamp).toISOString();
  const minimumSeparationSeconds = entry.tier === 'HOT' ? config.existingTokenHotScanSeconds : config.existingTokenWarmScanSeconds;
  if (!existingTokenObservationIsSeparated(prior.observations, observedAt, minimumSeparationSeconds)) return { candidate: false, qualified: false, emitted: false };
  const marketCap = finitePositive(market.marketCapUsd); const liquidity = finitePositive(market.liquidityUsd); const volume5m = finitePositive(market.volume5mUsd);
  const result = assessExistingTokenObservation({ prior, observedAt, price: market.priceUsd, marketCap, liquidity, volume5m, buys5m: market.buys5m, sells5m: market.sells5m });
  const firstAt = result.history[0]?.observedAt ?? observedAt; const elapsedSec = Math.max(0, (Date.parse(observedAt) - Date.parse(firstAt)) / 1000);
  const firstVolume = result.history.find(x => finitePositive(x.volume5m))?.volume5m ?? null; const peakRoi = Math.max(...result.history.map(x => x.roi));
  const rawData = { ...existingRisk, existingTokenScanner: true, state: result.assessment.state, intelligenceState: result.assessment.state,
    previousIntelligenceState: result.previousState, observations: result.history, marketCap, liquidity, volume5m, previousVolume5m: firstVolume,
    volumeMultiple: firstVolume && volume5m ? volume5m / firstVolume : null, buys5m: market.buys5m, sells5m: market.sells5m,
    currentRoi: result.history[result.history.length - 1]?.roi ?? 0, recentPeakRoi: peakRoi, elapsedSec, peakMarketCap: result.peakMarketCap,
    distanceFromAthMarketCapPct: result.peakMarketCap && marketCap ? (marketCap - result.peakMarketCap) / result.peakMarketCap * 100 : null,
    pairAddress: market.pairAddress, chartUrl: market.chartUrl, symbol: market.symbol, name: market.name,
    lastAlertState: prior.lastAlertState ?? null, lastAlertAt: prior.lastAlertAt ?? null };
  let qualified = false, emitted = false;
  if (result.alertable && result.transition) {
    const qualification = qualifyPremiumOpportunity(rawData, 'CHECK_ENTRY', entry.token);
    const cooldownPassed = !prior.lastAlertAt || Date.now() - Date.parse(prior.lastAlertAt) >= config.existingTokenAlertCooldownMinutes * 60_000;
    qualified = qualification.eligible;
    if (qualified && (cooldownPassed || result.previousState !== result.assessment.state)) {
      const kind = result.reentry ? 'REIGNITION' : result.assessment.state === 'RUNNER' ? 'RUNNER' : 'BREAKOUT';
      const title = result.reentry ? `${market.symbol} 🔄 TREND REVERSAL` : `${market.symbol} Existing Token ${kind}`;
      const actionRaw = { ...rawData, lastAlertState: result.assessment.state, lastAlertAt: observedAt };
      requirePersistedScannerOpportunity(await recordOpportunityAndEmit({ opportunityType: 'DEX_CONFIRMATION', assetId: entry.token, chain: 'robinhood', sourceAgent: 'ExistingTokenOpportunityScanner',
        title, strategyKey: `EXISTING_TOKEN_${kind}`, recommendedAction: 'CHECK_ENTRY', status: 'NEW', why: result.assessment.reasons.join(' '),
        whatHappened: result.reentry ? `Trend reversed from ${result.previousState} to ${result.assessment.state}.` : `Existing-token structure advanced from ${result.previousState} to ${result.assessment.state}.`,
        invalidation: 'Invalidate if sustained participation, price retention, liquidity, or buy pressure breaks down.',
        riskReason: 'Manual entry review required; fresh-wallet and security gates remain enforced at delivery.', confidence: result.assessment.state === 'RUNNER' ? 78 : 72,
        riskScore: 42, expiresAt: new Date(Date.now() + config.existingTokenAlertCooldownMinutes * 60_000).toISOString(), rawData: actionRaw }), `EXISTING_TOKEN_${kind}`);
      rawData.lastAlertState = result.assessment.state; rawData.lastAlertAt = observedAt; emitted = true;
    }
  }
  requirePersistedScannerOpportunity(await recordOpportunity({ opportunityType: 'DEX_CONFIRMATION', assetId: entry.token, chain: 'robinhood', sourceAgent: 'ExistingTokenOpportunityScanner',
    title: `${market.symbol} continuous monitoring`, strategyKey: 'EXISTING_TOKEN_MONITOR', recommendedAction: 'TRACK', status: 'WATCHING',
    why: result.assessment.reasons.join(' '), whatHappened: 'Lightweight comparable market observation recorded.', riskReason: null,
    confidence: 50, riskScore: 50, rawData }), 'EXISTING_TOKEN_MONITOR');
  return { candidate: result.alertable, qualified, emitted };
}

export async function runExistingTokenProviderBatch<T>(entries: ExistingTokenUniverseEntry[], process: (entry: ExistingTokenUniverseEntry) => Promise<T>,
  options: { concurrency?: number; budgetMs?: number; now?: () => number; backoffActive?: () => boolean } = {}) {
  const started = (options.now ?? Date.now)(); let next = 0, providerBackoff = false;
  const completed: Array<{ entry: ExistingTokenUniverseEntry; result: T }> = []; const failed: Array<{ entry: ExistingTokenUniverseEntry; error: unknown }> = [];
  const backoffActive = options.backoffActive ?? (() => getDexScreenerBackoffState().active);
  const worker = async () => {
    while (!providerBackoff && next < entries.length && (options.now ?? Date.now)() - started < (options.budgetMs ?? CYCLE_BUDGET_MS)) {
      if (backoffActive()) { providerBackoff = true; break; }
      const entry = entries[next++];
      try { completed.push({ entry, result: await process(entry) }); }
      catch (error) { if (isDexScreenerProviderBackoffError(error) || backoffActive()) { providerBackoff = true; continue; } failed.push({ entry, error }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? MAX_CONCURRENCY, entries.length) }, () => worker()));
  return { completed, failed, providerBackoff, skipped: Math.max(0, entries.length - completed.length - failed.length) };
}

export async function refreshExistingTokenOpportunityScanner() {
  if (scannerRunning) return { skipped: true };
  scannerRunning = true; const started = Date.now();
  const metrics = { health: 'HEALTHY', universe: 0, due: 0, selected: 0, scanned_success: 0, no_market: 0, failed: 0,
    queue_deferred: 0, cycle_deferred: 0, provider_backoff_deferred: 0, remaining_due: 0, candidates: 0, qualified: 0,
    actionable_emitted: 0, failure_reasons: {} as Record<string, number>, provider_backoff: false, duration_ms: 0 };
  try {
    const universe = await loadUniverse(); metrics.universe = universe.length;
    const quota = Math.min(config.existingTokenMaxPerCycle, EXISTING_TOKEN_SCANNER_SUSTAINABLE_QUOTA);
    const due = selectDueExistingTokens(universe, { max: quota }); hotCursor = due.nextHotCursor; warmCursor = due.nextWarmCursor;
    metrics.due = due.dueCount; metrics.selected = due.selected.length; metrics.queue_deferred = Math.max(0, due.dueCount - due.selected.length);
    if (metrics.queue_deferred) metrics.failure_reasons.DEFERRED_QUEUE_CAPACITY = metrics.queue_deferred;
    if (getDexScreenerBackoffState().active) {
      metrics.health = 'DEGRADED'; metrics.failed = 1; metrics.provider_backoff = true; metrics.provider_backoff_deferred = due.selected.length;
      metrics.failure_reasons.RATE_LIMITED = 1; metrics.remaining_due = due.dueCount; return metrics;
    }
    const batch = await runExistingTokenProviderBatch(due.selected, scanToken);
    recordCompletedExistingTokenScans(batch.completed.map(row => row.entry));
    for (const { result } of batch.completed) { metrics.scanned_success++; metrics.candidates += Number(result.candidate); metrics.qualified += Number(result.qualified); metrics.actionable_emitted += Number(result.emitted); }
    for (const { entry, error } of batch.failed) {
      const reason = error instanceof Error ? error.message : String(error);
      const category = error instanceof DexScreenerQueueCapacityError ? 'DEFERRED_QUEUE_CAPACITY' : error instanceof ExistingTokenNoUsablePairError ? 'NO_USABLE_PAIR'
        : error instanceof DexScreenerHttpTimeoutError ? 'HTTP_TIMEOUT' : error instanceof DexScreenerMalformedResponseError ? 'MALFORMED_RESPONSE'
        : error instanceof DexScreenerProviderHttpError ? 'PROVIDER_HTTP_ERROR' : isDexScreenerProviderBackoffError(error) ? 'RATE_LIMITED'
        : reason.startsWith('scanner persistence failed') ? 'PERSISTENCE_FAILED' : 'TOKEN_SCAN_FAILED';
      if (category === 'DEFERRED_QUEUE_CAPACITY') metrics.queue_deferred++; else if (category === 'NO_USABLE_PAIR') metrics.no_market++; else metrics.failed++;
      metrics.failure_reasons[category] = (metrics.failure_reasons[category] ?? 0) + 1;
      console.warn('[ExistingTokenScanner] token failed', { token: entry.token, category, reason });
    }
    if (batch.providerBackoff) { metrics.provider_backoff = true; metrics.failed += 1; metrics.failure_reasons.RATE_LIMITED = 1; metrics.provider_backoff_deferred = batch.skipped; }
    else if (batch.skipped) { metrics.cycle_deferred += batch.skipped; metrics.failure_reasons.CYCLE_BUDGET_DEFERRED = batch.skipped; }
    metrics.remaining_due = Math.max(0, due.dueCount - metrics.scanned_success);
    metrics.health = metrics.failed ? 'DEGRADED' : metrics.queue_deferred || metrics.cycle_deferred ? 'CAPACITY_LIMITED' : 'HEALTHY';
    return metrics;
  } catch (error) {
    metrics.failed++; metrics.health = 'DEGRADED'; console.error('[ExistingTokenScanner] cycle failed', { reason: error instanceof Error ? error.message : String(error) }); return metrics;
  } finally {
    metrics.duration_ms = Date.now() - started; scannerRunning = false; console.log('existing_token_scanner_cycle', metrics);
  }
}

export function startExistingTokenOpportunityScanner() {
  if (scannerStarted) return; scannerStarted = true;
  void refreshExistingTokenOpportunityScanner();
  scannerTimer = setInterval(() => void refreshExistingTokenOpportunityScanner(), SCANNER_TICK_MS);
}

export function stopExistingTokenOpportunityScanner() {
  if (scannerTimer) clearInterval(scannerTimer); scannerTimer = null; scannerStarted = false; scannerRunning = false;
}
