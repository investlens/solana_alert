import { config } from '../../config.js';
import { recordOpportunity } from '../../core/opportunityRegistry.js';
import { assessTokenIntelligence, type IntelligenceObservation, type TokenIntelligenceState } from '../../intelligence/tokenIntelligenceState.js';
import { recordOpportunityAndEmit } from '../../services/opportunityService.js';
import { qualifyPremiumOpportunity } from '../../services/opportunityDeliveryService.js';
import { supabase } from '../../services/supabase.js';
import { getRobinhoodMarketSnapshot } from './market.js';

export type ExistingTokenTier = 'HOT' | 'WARM';
export type ExistingTokenUniverseEntry = { token: string; tier: ExistingTokenTier; lastSeenAt: string; watched?: boolean };
export type ExistingTokenMonitorData = { state?: TokenIntelligenceState; intelligenceState?: TokenIntelligenceState; observations?: IntelligenceObservation[]; peakMarketCap?: number | null; lastAlertState?: TokenIntelligenceState | null; lastAlertAt?: string | null };
type UniverseRow = { asset_id?: string | null; token_address?: string | null; alerted_at?: string | null; created_at?: string | null; updated_at?: string | null; last_observed_at?: string | null; status?: string | null; strategy_key?: string | null; opportunities?: { asset_id?: string | null; chain?: string | null } | null };

const SCANNER_TICK_MS = 15_000;
const MAX_UNIVERSE_ROWS_PER_SOURCE = 100;
const MAX_HISTORY = 12;
const MAX_CONCURRENCY = 3;
const CYCLE_BUDGET_MS = 20_000;
let scannerStarted = false;
let scannerRunning = false;
let scannerTimer: ReturnType<typeof setInterval> | null = null;
let hotCursor = 0;
let warmCursor = 0;
const lastScannedAt = new Map<string, number>();

export function requirePersistedScannerOpportunity<T>(value: T | null, strategyKey: string): T {
  if (value == null) throw new Error(`scanner persistence failed for ${strategyKey}`);
  return value;
}

const normalize = (value: string) => value.trim().toLowerCase();
const rowTime = (row: UniverseRow) => row.last_observed_at ?? row.alerted_at ?? row.updated_at ?? row.created_at ?? new Date(0).toISOString();
const finitePositive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function existingTokenObservationIsSeparated(
  observations: IntelligenceObservation[] | undefined,
  observedAt: string,
  minimumSeconds: number,
) {
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
      String(row.strategy_key ?? '').toUpperCase().includes('RUNNER'));
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
  const hot = due.filter(x => x.tier === 'HOT'); const warm = due.filter(x => x.tier === 'WARM');
  const hotStart = hot.length ? (args.hotStart ?? hotCursor) % hot.length : 0;
  const warmStart = warm.length ? (args.warmStart ?? warmCursor) % warm.length : 0;
  const rotatedHot = [...hot.slice(hotStart), ...hot.slice(0, hotStart)];
  const rotatedWarm = [...warm.slice(warmStart), ...warm.slice(0, warmStart)];
  const hotAllowance = warm.length && max > 1 ? max - 1 : max;
  const selected = [...rotatedHot.slice(0, hotAllowance), ...rotatedWarm].slice(0, max);
  return { selected, dueCount: due.length,
    nextHotCursor: hot.length ? (hotStart + Math.max(1, selected.filter(x => x.tier === 'HOT').length)) % hot.length : 0,
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
  const cutoff = new Date(Date.now() - config.existingTokenRetentionHours * 3_600_000).toISOString();
  const [opportunities, observations, events, wallet, watched] = await Promise.all([
    supabase.from('opportunities').select('asset_id,status,strategy_key,last_observed_at,updated_at').eq('chain', 'robinhood').order('last_observed_at', { ascending: false }).limit(MAX_UNIVERSE_ROWS_PER_SOURCE),
    supabase.from('robinhood_observations').select('token_address,updated_at,status').gte('updated_at', cutoff).order('updated_at', { ascending: false }).limit(MAX_UNIVERSE_ROWS_PER_SOURCE),
    supabase.from('alpha_alert_events').select('asset_id,alerted_at').eq('chain', 'robinhood').gte('alerted_at', cutoff).order('alerted_at', { ascending: false }).limit(MAX_UNIVERSE_ROWS_PER_SOURCE),
    supabase.from('wallet_activity_deliveries').select('token_address,created_at').not('token_address', 'is', null).gte('created_at', cutoff).order('created_at', { ascending: false }).limit(MAX_UNIVERSE_ROWS_PER_SOURCE),
    supabase.from('user_opportunity_watchlist').select('updated_at,opportunities(asset_id,chain)').limit(MAX_UNIVERSE_ROWS_PER_SOURCE),
  ]);
  for (const result of [opportunities, observations, events, wallet, watched]) if (result.error) throw result.error;
  return buildExistingTokenUniverse({ opportunities: opportunities.data ?? [], observations: observations.data ?? [], events: events.data ?? [], wallet: wallet.data ?? [], watched: watched.data as unknown as UniverseRow[] ?? [] });
}

async function scanToken(entry: ExistingTokenUniverseEntry) {
  const { data: contexts, error } = await supabase.from('opportunities').select('strategy_key,raw_data').eq('chain', 'robinhood').eq('asset_id', entry.token).order('updated_at', { ascending: false }).limit(20);
  if (error) throw error;
  const monitor = contexts?.find(row => row.strategy_key === 'EXISTING_TOKEN_MONITOR');
  const prior = (monitor?.raw_data ?? {}) as ExistingTokenMonitorData;
  const existingRisk = (contexts ?? []).map(row => (row.raw_data ?? {}) as Record<string, unknown>)
    .find(raw => raw.confirmedDevSell === true || raw.criticalSecurity === true || raw.liquidityCritical === true) ?? {};
  const market = await getRobinhoodMarketSnapshot(entry.token); if (!market) throw new Error('verified market unavailable');
  const observedAt = new Date(market.timestamp).toISOString();
  const minimumSeparationSeconds = entry.tier === 'HOT' ? config.existingTokenHotScanSeconds : config.existingTokenWarmScanSeconds;
  if (!existingTokenObservationIsSeparated(prior.observations, observedAt, minimumSeparationSeconds)) {
    return { candidate: false, qualified: false, emitted: false };
  }
  const marketCap = finitePositive(market.marketCapUsd);
  const liquidity = finitePositive(market.liquidityUsd);
  const volume5m = finitePositive(market.volume5mUsd);
  const result = assessExistingTokenObservation({ prior, observedAt, price: market.priceUsd, marketCap,
    liquidity, volume5m, buys5m: market.buys5m, sells5m: market.sells5m });
  const firstAt = result.history[0]?.observedAt ?? observedAt; const elapsedSec = Math.max(0, (Date.parse(observedAt) - Date.parse(firstAt)) / 1000);
  const firstVolume = result.history.find(x => finitePositive(x.volume5m))?.volume5m ?? null;
  const peakRoi = Math.max(...result.history.map(x => x.roi));
  const rawData = { ...existingRisk, existingTokenScanner: true, state: result.assessment.state,
    intelligenceState: result.assessment.state, previousIntelligenceState: result.previousState,
    observations: result.history, marketCap, liquidity, volume5m,
    previousVolume5m: firstVolume, volumeMultiple: firstVolume && volume5m ? volume5m / firstVolume : null,
    buys5m: market.buys5m, sells5m: market.sells5m, currentRoi: result.history[result.history.length - 1]?.roi ?? 0, recentPeakRoi: peakRoi,
    elapsedSec, peakMarketCap: result.peakMarketCap, distanceFromAthMarketCapPct: result.peakMarketCap && marketCap ? (marketCap - result.peakMarketCap) / result.peakMarketCap * 100 : null,
    pairAddress: market.pairAddress, chartUrl: market.chartUrl, symbol: market.symbol, name: market.name,
    lastAlertState: prior.lastAlertState ?? null, lastAlertAt: prior.lastAlertAt ?? null };
  let qualified = false, emitted = false;
  if (result.alertable && result.transition) {
    const qualification = qualifyPremiumOpportunity(rawData, 'CHECK_ENTRY', entry.token);
    const cooldownPassed = !prior.lastAlertAt || Date.now() - Date.parse(prior.lastAlertAt) >= config.existingTokenAlertCooldownMinutes * 60_000;
    qualified = qualification.eligible;
    if (qualified && (cooldownPassed || result.previousState !== result.assessment.state)) {
      const kind = result.reentry ? 'REIGNITION' : result.assessment.state === 'RUNNER' ? 'RUNNER' : 'BREAKOUT';
      const actionRaw = { ...rawData, lastAlertState: result.assessment.state, lastAlertAt: observedAt };
      requirePersistedScannerOpportunity(await recordOpportunityAndEmit({ opportunityType: 'DEX_CONFIRMATION', assetId: entry.token, chain: 'robinhood', sourceAgent: 'ExistingTokenOpportunityScanner',
        title: `${market.symbol} Existing Token ${kind}`, strategyKey: `EXISTING_TOKEN_${kind}`, recommendedAction: 'CHECK_ENTRY', status: 'NEW',
        why: result.assessment.reasons.join(' '), whatHappened: `Existing-token structure advanced from ${result.previousState} to ${result.assessment.state} without requiring a new BOOST or DEX Paid event.`,
        invalidation: 'Invalidate if sustained participation, price retention, liquidity, or buy pressure breaks down.', riskReason: 'Manual entry review required; fresh-wallet and security gates remain enforced at delivery.',
        confidence: result.assessment.state === 'RUNNER' ? 78 : 72, riskScore: 42,
        expiresAt: new Date(Date.now() + config.existingTokenAlertCooldownMinutes * 60_000).toISOString(), rawData: actionRaw }), `EXISTING_TOKEN_${kind}`);
      rawData.lastAlertState = result.assessment.state; rawData.lastAlertAt = observedAt; emitted = true;
    }
  }
  requirePersistedScannerOpportunity(await recordOpportunity({ opportunityType: 'DEX_CONFIRMATION', assetId: entry.token, chain: 'robinhood', sourceAgent: 'ExistingTokenOpportunityScanner',
    title: `${market.symbol} continuous monitoring`, strategyKey: 'EXISTING_TOKEN_MONITOR', recommendedAction: 'TRACK', status: 'WATCHING',
    why: result.assessment.reasons.join(' '), whatHappened: 'Lightweight comparable market observation recorded.', riskReason: null,
    confidence: 50, riskScore: 50, rawData }), 'EXISTING_TOKEN_MONITOR');
  return { candidate: result.alertable, qualified, emitted };
}

export async function refreshExistingTokenOpportunityScanner() {
  if (scannerRunning) return { skipped: true };
  scannerRunning = true; const started = Date.now();
  const metrics = { health: 'HEALTHY', universe_size: 0, tokens_due: 0, tokens_scanned: 0, candidates: 0, qualified: 0,
    actionable_emitted: 0, delivered: null, deduped: null, fresh_wallet_blocked: null, failures: 0,
    failure_reasons: {} as Record<string, number>, duration_ms: 0 };
  try {
    const universe = await loadUniverse(); metrics.universe_size = universe.length;
    const due = selectDueExistingTokens(universe); hotCursor = due.nextHotCursor; warmCursor = due.nextWarmCursor; metrics.tokens_due = due.dueCount;
    let next = 0;
    const worker = async () => {
      while (next < due.selected.length && Date.now() - started < CYCLE_BUDGET_MS) {
        const entry = due.selected[next++];
        try { const result = await scanToken(entry); lastScannedAt.set(entry.token, Date.now()); metrics.tokens_scanned++; metrics.candidates += Number(result.candidate); metrics.qualified += Number(result.qualified); metrics.actionable_emitted += Number(result.emitted); }
        catch (error) { metrics.failures++; const reason = error instanceof Error ? error.message : String(error);
          const category = reason.startsWith('scanner persistence failed') ? 'PERSISTENCE_FAILED' : reason === 'verified market unavailable' ? 'MARKET_UNAVAILABLE' : 'TOKEN_SCAN_FAILED';
          metrics.failure_reasons[category] = (metrics.failure_reasons[category] ?? 0) + 1;
          console.warn('[ExistingTokenScanner] token failed', { token: entry.token, category, reason }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, due.selected.length) }, () => worker()));
    metrics.health = metrics.failures ? 'DEGRADED' : metrics.tokens_scanned < metrics.tokens_due ? 'CATCHING_UP' : 'HEALTHY';
    return metrics;
  } catch (error) { metrics.failures++; metrics.health = 'DEGRADED'; console.error('[ExistingTokenScanner] cycle failed', { reason: error instanceof Error ? error.message : String(error) }); return metrics; }
  finally { metrics.duration_ms = Date.now() - started; scannerRunning = false; console.log('existing_token_scanner_cycle', metrics); }
}

export function startExistingTokenOpportunityScanner() {
  if (scannerStarted) return; scannerStarted = true;
  void refreshExistingTokenOpportunityScanner();
  scannerTimer = setInterval(() => void refreshExistingTokenOpportunityScanner(), SCANNER_TICK_MS);
}

export function stopExistingTokenOpportunityScanner() {
  if (scannerTimer) clearInterval(scannerTimer); scannerTimer = null; scannerStarted = false; scannerRunning = false;
}
