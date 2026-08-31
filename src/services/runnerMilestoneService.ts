import { buildAlphaMarketActions } from '../ui/alphaNotificationActions.js';
import { escapeHtml } from '../ui/alphaAlert/index.js';
import { persistOrLoadAlphaSemanticEventRecord, type AlphaSemanticEventType } from './alphaSemanticEventService.js';
import { deliverAlphaSemanticEvent } from './alphaSemanticDeliveryService.js';
import { compareVerifiedPrices, type PriceEvidence } from './priceComparability.js';
import { supabase } from './supabase.js';

export const ATH_ALERT_EXPANSION_PERCENT = 30;
export const NEW_ATH_ALERT_MIN_INCREASE_PCT = ATH_ALERT_EXPANSION_PERCENT;
export const runnerMilestoneIdentity = (canonicalThesis: string, threshold: 50 | 100) =>
  `runner:${canonicalThesis}:${threshold}`;
export const athObservationIdentity = (canonicalThesis: string, observationIdentity: number | string) =>
  `ath-observation:${canonicalThesis}:${observationIdentity}`;
export const athAlertIdentity = (canonicalThesis: string, observationIdentity: number | string) =>
  `ath-alert:${canonicalThesis}:${observationIdentity}`;

export type RunnerEntry = {
  id: number; event_identity: string; opportunity_id?: number | null; asset_id: string; chain: string;
  lifecycle_action?: string | null;
  strategy_key?: string | null; symbol?: string | null; price: number | string | null;
  price_provenance?: string | null; market_index_state?: string | null; alerted_at: string;
  intelligence_state?: string | null; risk_label?: string | null; volume_5m?: number | string | null;
  raw_snapshot?: Record<string, unknown> | null;
};

export type RunnerObservation = {
  outcomeId?: number | null; alertEventId: number; currentPrice: number | string | null;
  priceProvenance?: string | null; measuredAt: string; measurementSource?: string | null;
  intelligenceState?: string | null; riskLabel?: string | null; volume5m?: number | string | null;
};

type StoredRunnerOutcome = {
  id: number; alert_event_id: number; current_price: number | string | null;
  price_provenance?: string | null; measured_at: string; measurement_source?: string | null;
  status?: string | null;
};

export type RunnerHistoryPrice = PriceEvidence & {
  id?: number | null; observedAt: string; semanticType?: string | null;
};

export type RunnerMilestonePlan = {
  comparable: boolean; reason: string | null; roi: number | null;
  runner50: boolean; runner100: boolean; newAthObserved: boolean; athAlert: boolean;
  previousAth: number | null; newAth: number | null; lastAlertedAth: number | null;
};

export type WinnerDeliveryKind = 'RUNNER_50' | 'RUNNER_100' | 'NEW_ATH';

export function selectWinnerDelivery(args: {
  runner50: boolean; runner100: boolean; athAlert: boolean;
}): WinnerDeliveryKind | null {
  if (args.runner100) return 'RUNNER_100';
  if (args.runner50) return 'RUNNER_50';
  if (args.athAlert) return 'NEW_ATH';
  return null;
}

const positive = (value: unknown): number | null => {
  const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function evidence(entry: RunnerEntry | RunnerHistoryPrice, price: number | string | null, provenance?: string | null): PriceEvidence {
  return { chain: entry.chain, token: 'asset_id' in entry ? entry.asset_id : entry.token,
    price, provenance, marketIndexState: (entry as RunnerEntry).market_index_state ?? (entry as RunnerHistoryPrice).marketIndexState };
}

export function canonicalRunnerEntry(entries: RunnerEntry[], deliveredEventIds: Set<number>): RunnerEntry | null {
  return entries.filter(entry => deliveredEventIds.has(entry.id) && ['BUY', 'CHECK_ENTRY'].includes(String(entry.lifecycle_action ?? '').toUpperCase()))
    .filter(entry => compareVerifiedPrices(evidence(entry, entry.price, entry.price_provenance), evidence(entry, entry.price, entry.price_provenance)).comparable)
    .sort((a, b) => Date.parse(a.alerted_at) - Date.parse(b.alerted_at) || a.id - b.id)[0] ?? null;
}

function highestComparable(entry: RunnerEntry, observation: RunnerObservation, history: RunnerHistoryPrice[]): number | null {
  const current: PriceEvidence = { chain: entry.chain, token: entry.asset_id, price: observation.currentPrice,
    provenance: observation.priceProvenance, marketIndexState: entry.market_index_state };
  const values = history.filter(item => Date.parse(item.observedAt) <= Date.parse(observation.measuredAt))
    .flatMap(item => {
      const compared = compareVerifiedPrices({ chain: item.chain, token: item.token, price: item.price,
        provenance: item.provenance, quote: item.quote, marketIndexState: item.marketIndexState }, current);
      return compared.comparable ? [Number(item.price)] : [];
    });
  return values.length ? Math.max(...values) : positive(entry.price);
}

export function planRunnerMilestones(args: {
  entry: RunnerEntry | null; observation: RunnerObservation; history: RunnerHistoryPrice[];
  existingSemanticTypes?: Set<string>; lastAlertedAth?: number | null; athNotificationBaseline?: number | null;
  athAlertMinIncreasePct?: number;
}): RunnerMilestonePlan {
  const empty = (reason: string): RunnerMilestonePlan => ({ comparable: false, reason, roi: null, runner50: false,
    runner100: false, newAthObserved: false, athAlert: false, previousAth: null, newAth: null,
    lastAlertedAth: positive(args.lastAlertedAth) });
  if (!args.entry) return empty('NO_CANONICAL_ENTRY');
  const currentPrice = positive(args.observation.currentPrice);
  const comparison = compareVerifiedPrices(evidence(args.entry, args.entry.price, args.entry.price_provenance), {
    chain: args.entry.chain, token: args.entry.asset_id, price: currentPrice,
    provenance: args.observation.priceProvenance, marketIndexState: args.entry.market_index_state,
  });
  if (!comparison.comparable) return empty('reason' in comparison ? comparison.reason : 'INCOMPARABLE_PRICE');
  const semantic = args.existingSemanticTypes ?? new Set<string>();
  const previousAth = highestComparable(args.entry, args.observation, args.history);
  const newAthObserved = previousAth != null && currentPrice != null && currentPrice > previousAth;
  const lastAlertedAth = positive(args.lastAlertedAth);
  const alertReference = lastAlertedAth ?? positive(args.athNotificationBaseline);
  const minimum = Number.isFinite(args.athAlertMinIncreasePct) ? Number(args.athAlertMinIncreasePct) : ATH_ALERT_EXPANSION_PERCENT;
  const athIncrease = newAthObserved && alertReference ? ((currentPrice! - alertReference) / alertReference) * 100 : 0;
  return { comparable: true, reason: null, roi: comparison.changePct,
    runner50: comparison.changePct >= 50 && !semantic.has('RUNNER_50'),
    runner100: comparison.changePct >= 100 && !semantic.has('RUNNER_100'),
    newAthObserved, athAlert: newAthObserved && athIncrease + 1e-9 >= minimum,
    previousAth, newAth: newAthObserved ? currentPrice : previousAth, lastAlertedAth };
}

export function highestComparableRunnerObservation(entry: RunnerEntry, observations: RunnerObservation[]): {
  observation: RunnerObservation; roi: number;
} | null {
  let highest: { observation: RunnerObservation; roi: number } | null = null;
  for (const observation of observations) {
    if (Date.parse(observation.measuredAt) < Date.parse(entry.alerted_at)) continue;
    const comparison = compareVerifiedPrices(evidence(entry, entry.price, entry.price_provenance), {
      chain: entry.chain, token: entry.asset_id, price: observation.currentPrice,
      provenance: observation.priceProvenance,
      marketIndexState: observation.priceProvenance === 'DEXSCREENER_VERIFIED_BASE_PAIR'
        ? 'VERIFIED' : entry.market_index_state,
    });
    if (!comparison.comparable || (highest && comparison.changePct <= highest.roi)) continue;
    highest = { observation, roi: comparison.changePct };
  }
  return highest;
}

function price(value: number): string {
  if (value >= 1) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 12 })}`;
}

function interpretation(entry: RunnerEntry, observation: RunnerObservation, major: boolean): string {
  const risk = String(observation.riskLabel ?? entry.risk_label ?? '').toUpperCase();
  const state = String(observation.intelligenceState ?? entry.intelligence_state ?? '').toUpperCase();
  if (['CRITICAL', 'DANGER', 'HIGH'].some(value => risk.includes(value)))
    return `${major ? 'Major runner achieved' : 'Runner milestone achieved'}, but critical risk is present — protect gains.`;
  if (['COOLING', 'WEAKENING', 'FADING'].includes(state))
    return `${major ? 'Major runner achieved' : 'Runner milestone achieved'}, but momentum is cooling — protect gains.`;
  return `${major ? 'Major runner intact' : 'Runner intact'} — protect profit, don't chase.`;
}

export function renderRunnerMilestone(args: { kind: 'RUNNER_50' | 'RUNNER_100'; entry: RunnerEntry;
  observation: RunnerObservation; roi: number; ath?: { baseline: number; current: number; expansionPct: number } | null }): string {
  const symbol = escapeHtml(args.entry.symbol ?? args.entry.asset_id);
  const entry = price(Number(args.entry.price)), current = price(Number(args.observation.currentPrice));
  const view = escapeHtml(interpretation(args.entry, args.observation, args.kind === 'RUNNER_100'));
  const ath = args.ath ? ['', `AlphaOS ATH: <b>${price(args.ath.current)}</b>`,
    `ATH Expansion: <b>+${args.ath.expansionPct.toFixed(1)}%</b>`] : [];
  if (args.kind === 'RUNNER_100') return [
    `🔥 <b>+100% MAJOR RUNNER — ${symbol}</b>`, '',
    `AlphaOS Entry: <b>${entry}</b>`, `Current: <b>${current}</b>`, `Return: <b>+${args.roi.toFixed(1)}%</b>`, '',
    '🏆 AlphaOS entry has doubled.', ...ath, '', '<b>AlphaOS View</b>', view,
  ].join('\n');
  return [
    `🚀 <b>+50% RUNNER — ${symbol}</b>`, '', `AlphaOS Entry: <b>${entry}</b>`, `Current: <b>${current}</b>`,
    `Return: <b>+${args.roi.toFixed(1)}%</b>`, '', '🎯 AlphaOS entry is running.', ...ath,
    '', '<b>AlphaOS View</b>', view,
  ].join('\n');
}

export function renderAthMilestone(args: { entry: RunnerEntry; observation: RunnerObservation; previousAth: number;
  newAth: number; roi: number }): string {
  const symbol = escapeHtml(args.entry.symbol ?? args.entry.asset_id);
  const expansion = ((args.newAth - args.previousAth) / args.previousAth) * 100;
  return [`👑 <b>ATH BREAKOUT — ${symbol}</b>`, '', `AlphaOS Entry: <b>${price(Number(args.entry.price))}</b>`,
    `Current ATH: <b>${price(args.newAth)}</b>`, `Return Since Entry: <b>+${args.roi.toFixed(1)}%</b>`, '',
    `Previous Alerted/Baseline ATH: <b>${price(args.previousAth)}</b>`,
    `ATH Expansion: <b>+${expansion.toFixed(1)}%</b>`, '', '🏆 New verified AlphaOS market high.'].join('\n');
}

function milestoneButtons(entry: RunnerEntry) {
  const raw = entry.raw_snapshot ?? {}; const chartUrl = typeof raw.chartUrl === 'string' ? raw.chartUrl : null;
  const tokenUrl = `https://robinhoodchain.blockscout.com/token/${entry.asset_id}`;
  return buildAlphaMarketActions({ chartUrl, tokenUrl,
    fullIntelCallback: /^0x[a-fA-F0-9]{40}$/.test(entry.asset_id) ? `FI_RH_${entry.asset_id}` : null,
    trackCallback: entry.opportunity_id ? `OPP_TRACK_${entry.opportunity_id}` : null,
    copyContractCallback: /^0x[a-fA-F0-9]{40}$/.test(entry.asset_id) ? `COPY_CA_${entry.asset_id}` : null,
    muteCallback: entry.strategy_key && Buffer.byteLength(`STRAT_TOGGLE_${entry.strategy_key}`, 'utf8') <= 64
      ? `STRAT_TOGGLE_${entry.strategy_key}` : null });
}

async function persistMilestone(type: AlphaSemanticEventType, identity: string, entry: RunnerEntry,
  observation: RunnerObservation, roi: number, extra: Record<string, unknown> = {}) {
  return persistOrLoadAlphaSemanticEventRecord({ identity, type, assetId: entry.asset_id, chain: entry.chain,
    intelligenceState: observation.intelligenceState ?? entry.intelligence_state, strategyKey: entry.strategy_key,
    symbol: entry.symbol, alertedAt: observation.measuredAt, rawSnapshot: {
      priceWhenVerified: Number(observation.currentPrice), priceProvenance: observation.priceProvenance,
      marketIndexState: entry.market_index_state, currentRoi: roi, canonicalEntryEventId: entry.id,
      canonicalEntryIdentity: entry.event_identity, canonicalEntryPrice: Number(entry.price),
      measurementSource: observation.measurementSource, outcomeId: observation.outcomeId, ...extra,
    } });
}

export async function processRunnerMilestones(observation: RunnerObservation): Promise<RunnerMilestonePlan> {
  const { data: origin, error: originError } = await supabase.from('alpha_alert_events').select('*').eq('id', observation.alertEventId).single();
  if (originError) throw originError;
  const { data: entries, error: entryError } = await supabase.from('alpha_alert_events').select('*')
    .eq('chain', origin.chain).ilike('asset_id', origin.asset_id).in('lifecycle_action', ['BUY', 'CHECK_ENTRY'])
    .order('alerted_at', { ascending: true }).limit(200);
  if (entryError) throw entryError;
  const ids = (entries ?? []).map(row => Number(row.id));
  const opportunityIds = (entries ?? []).map(row => Number(row.opportunity_id)).filter(Number.isFinite);
  const [semanticDeliveries, opportunityDeliveries] = await Promise.all([
    ids.length ? supabase.from('alpha_alert_event_deliveries').select('alert_event_id').in('alert_event_id', ids)
      .not('delivered_at', 'is', null) : Promise.resolve({ data: [], error: null }),
    opportunityIds.length ? supabase.from('opportunity_deliveries').select('opportunity_id').in('opportunity_id', opportunityIds)
      .not('delivered_at', 'is', null) : Promise.resolve({ data: [], error: null }),
  ]);
  if (semanticDeliveries.error) throw semanticDeliveries.error;
  if (opportunityDeliveries.error) throw opportunityDeliveries.error;
  const deliveredIds = new Set((semanticDeliveries.data ?? []).map(row => Number(row.alert_event_id)));
  const deliveredOpportunityIds = new Set((opportunityDeliveries.data ?? []).map(row => Number(row.opportunity_id)));
  for (const row of entries ?? []) if (deliveredOpportunityIds.has(Number(row.opportunity_id))) deliveredIds.add(Number(row.id));
  const entry = canonicalRunnerEntry((entries ?? []) as RunnerEntry[], deliveredIds);
  if (!entry) return planRunnerMilestones({ entry: null, observation, history: [] });
  const { data: historyRows, error: historyError } = await supabase.from('alpha_alert_events')
    .select('id,asset_id,chain,price,price_provenance,market_index_state,alerted_at,semantic_event_type')
    .eq('chain', entry.chain).ilike('asset_id', entry.asset_id).lte('alerted_at', observation.measuredAt)
    .order('alerted_at', { ascending: true }).limit(1000);
  if (historyError) throw historyError;
  const history: RunnerHistoryPrice[] = (historyRows ?? []).filter(row => positive(row.price) != null).map(row => ({ id: Number(row.id), chain: row.chain,
    token: row.asset_id, price: row.price, provenance: row.price_provenance, marketIndexState: row.market_index_state,
    observedAt: row.alerted_at, semanticType: row.semantic_event_type }));
  const existingSemanticTypes = new Set(history.map(row => String(row.semanticType ?? '')).filter(Boolean));
  const athAlerts = history.filter(row => row.semanticType === 'NEW_ATH' && compareVerifiedPrices(
    evidence(entry, entry.price, entry.price_provenance), row).comparable);
  let lastAlertedAth = athAlerts.length ? Number(athAlerts[athAlerts.length - 1].price) : null;
  const athObservations = history.filter(row => row.semanticType === 'ATH_OBSERVATION' && compareVerifiedPrices(
    evidence(entry, entry.price, entry.price_provenance), row).comparable);
  let athNotificationBaseline = lastAlertedAth ?? (athObservations.length ? Number(athObservations[0].price) : null);
  const { data: storedRows, error: storedError } = await supabase.from('alpha_alert_outcomes')
      .select('id,alert_event_id,current_price,price_provenance,measured_at,measurement_source,status')
      .eq('alert_event_id', entry.id).eq('status', 'MEASURED').gte('measured_at', entry.alerted_at)
      .lte('measured_at', observation.measuredAt).order('measured_at', { ascending: true }).limit(5000);
  if (storedError) throw storedError;
  const storedObservations: RunnerObservation[] = ((storedRows ?? []) as StoredRunnerOutcome[]).map(row => ({
    outcomeId: Number(row.id), alertEventId: Number(row.alert_event_id), currentPrice: row.current_price,
    priceProvenance: row.price_provenance, measuredAt: row.measured_at, measurementSource: row.measurement_source,
  })).filter(item => compareVerifiedPrices(evidence(entry, entry.price, entry.price_provenance), {
    chain: entry.chain, token: entry.asset_id, price: item.currentPrice, provenance: item.priceProvenance,
    marketIndexState: item.priceProvenance === 'DEXSCREENER_VERIFIED_BASE_PAIR'
      ? 'VERIFIED' : entry.market_index_state,
  }).comparable);
  if (observation.alertEventId === entry.id &&
      !storedObservations.some(item => item.outcomeId != null && item.outcomeId === observation.outcomeId)) {
    storedObservations.push(observation);
    storedObservations.sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
  }
  const highest = highestComparableRunnerObservation(entry, storedObservations);
  if (!highest) return planRunnerMilestones({ entry, observation, history, existingSemanticTypes,
    lastAlertedAth, athNotificationBaseline });
  const milestoneObservation = { ...highest.observation, intelligenceState: observation.intelligenceState,
    riskLabel: observation.riskLabel, volume5m: observation.volume5m };
  const plan = planRunnerMilestones({ entry, observation: milestoneObservation, history, existingSemanticTypes,
    lastAlertedAth, athNotificationBaseline });
  const thesis = entry.event_identity;
  // Rebuild ATH notification decisions from immutable comparable observations. Persist/load identities and
  // the delivery ledger make this replay restart-safe, including a restart between ATH storage and delivery.
  const evolvingHistory = history.filter(row => !['ATH_OBSERVATION', 'NEW_ATH', 'RUNNER_50', 'RUNNER_100']
    .includes(String(row.semanticType ?? '')));
  lastAlertedAth = null;
  athNotificationBaseline = null;
  let deliverableAth: { event: { id: number; event_identity: string }; observation: RunnerObservation;
    previousAth: number; newAth: number; roi: number; expansionPct: number } | null = null;
  for (const tracked of storedObservations) {
    const athPlan = planRunnerMilestones({ entry, observation: tracked, history: evolvingHistory,
      existingSemanticTypes, lastAlertedAth, athNotificationBaseline });
    if (!athPlan.comparable || athPlan.roi == null || !athPlan.newAthObserved || athPlan.previousAth == null || athPlan.newAth == null) continue;
    const athEvent = await persistMilestone('ATH_OBSERVATION', athObservationIdentity(thesis, tracked.outcomeId ?? tracked.measuredAt),
      entry, tracked, athPlan.roi, { previousVerifiedAth: athPlan.previousAth, newVerifiedAth: athPlan.newAth,
        silentBaseline: athNotificationBaseline == null });
    evolvingHistory.push({ id: athEvent.id, chain: entry.chain, token: entry.asset_id, price: athPlan.newAth,
      provenance: tracked.priceProvenance, marketIndexState: entry.market_index_state,
      observedAt: tracked.measuredAt, semanticType: 'ATH_OBSERVATION' });
    if (athNotificationBaseline == null) { athNotificationBaseline = athPlan.newAth; continue; }
    if (!athPlan.athAlert) continue;
    const alertBaseline = lastAlertedAth ?? athNotificationBaseline;
    const alertEvent = await persistMilestone('NEW_ATH', athAlertIdentity(thesis, tracked.outcomeId ?? tracked.measuredAt),
      entry, tracked, athPlan.roi, { previousVerifiedAth: athPlan.previousAth, newVerifiedAth: athPlan.newAth,
        lastAlertedAth, alertBaseline, coalescingEligible: true });
    evolvingHistory.push({ id: alertEvent.id, chain: entry.chain, token: entry.asset_id, price: athPlan.newAth,
      provenance: tracked.priceProvenance, marketIndexState: entry.market_index_state,
      observedAt: tracked.measuredAt, semanticType: 'NEW_ATH' });
    const sameObservation = (tracked.outcomeId != null && tracked.outcomeId === milestoneObservation.outcomeId) ||
      tracked.measuredAt === milestoneObservation.measuredAt;
    if (sameObservation) deliverableAth = { event: alertEvent, observation: tracked,
      previousAth: alertBaseline, newAth: athPlan.newAth, roi: athPlan.roi,
      expansionPct: ((athPlan.newAth - alertBaseline) / alertBaseline) * 100 };
    lastAlertedAth = athPlan.newAth;
    athNotificationBaseline = athPlan.newAth;
  }
  const runnerEvents = new Map<'RUNNER_50' | 'RUNNER_100', { id: number; event_identity: string }>();
  for (const kind of ['RUNNER_50', 'RUNNER_100'] as const) {
    if (!plan[kind === 'RUNNER_50' ? 'runner50' : 'runner100']) continue;
    const event = await persistMilestone(kind, runnerMilestoneIdentity(thesis, kind === 'RUNNER_50' ? 50 : 100), entry, milestoneObservation, plan.roi);
    runnerEvents.set(kind, event);
  }
  const primary = selectWinnerDelivery({ runner50: plan.runner50, runner100: plan.runner100,
    athAlert: deliverableAth != null });
  if (primary === 'RUNNER_50' || primary === 'RUNNER_100') {
    const event = runnerEvents.get(primary)!;
    await deliverAlphaSemanticEvent({ event: { id: event.id, eventIdentity: event.event_identity, type: primary,
      assetId: entry.asset_id, chain: entry.chain, strategyKey: entry.strategy_key },
      message: renderRunnerMilestone({ kind: primary, entry, observation: milestoneObservation, roi: plan.roi!,
        ath: deliverableAth ? { baseline: deliverableAth.previousAth, current: deliverableAth.newAth,
          expansionPct: deliverableAth.expansionPct } : null }), buttons: milestoneButtons(entry), preserveMessage: true });
  } else if (primary === 'NEW_ATH' && deliverableAth) {
    await deliverAlphaSemanticEvent({ event: { id: deliverableAth.event.id,
      eventIdentity: deliverableAth.event.event_identity, type: 'NEW_ATH', assetId: entry.asset_id,
      chain: entry.chain, strategyKey: entry.strategy_key },
      message: renderAthMilestone({ entry, observation: deliverableAth.observation,
        previousAth: deliverableAth.previousAth, newAth: deliverableAth.newAth, roi: deliverableAth.roi }),
      buttons: milestoneButtons(entry), preserveMessage: true });
  }
  return plan;
}
