import { persistOrLoadAlphaSemanticEventRecord, type AlphaSemanticEventType } from './alphaSemanticEventService.js';
import { deliverAlphaSemanticEvent } from './alphaSemanticDeliveryService.js';
import { supabase } from './supabase.js';

const POLL_MS = Math.max(60_000, Number(process.env.POST_ALERT_LIFECYCLE_POLL_MS ?? 60_000));
const LOOKBACK_MS = Math.max(60 * 60_000, Number(process.env.POST_ALERT_LIFECYCLE_LOOKBACK_MS ?? 6 * 60 * 60_000));
const MIN_PEAK_ROI = Number(process.env.POST_ALERT_REVERSAL_MIN_PEAK_ROI ?? 20);
const WEAKENING_DRAWDOWN = Number(process.env.POST_ALERT_WEAKENING_DRAWDOWN ?? 25);
const DANGER_DRAWDOWN = Number(process.env.POST_ALERT_DANGER_DRAWDOWN ?? 45);
const SOURCE_TYPES = new Set(['BOOST', 'VOLUME_SURGE', 'DEX_PAID', 'DEV_BURN', 'PONS_PROVEN_DEV_LAUNCH']);

type AlertEvent = { id: number; event_identity: string; asset_id: string; chain: string; symbol: string | null; strategy_key: string | null; semantic_event_type: string | null; alerted_at: string };
type Outcome = { alert_event_id: number; checkpoint_seconds: number; current_roi: number | string | null; peak_roi: number | string | null; max_drawdown: number | string | null; current_price: number | string | null; peak_price: number | string | null; price_provenance: string | null; measured_at: string; status: string };

const finite = (value: unknown): number | null => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const html = (value: unknown): string => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function money(value: number | null): string { if (value == null || value <= 0) return 'Unavailable'; if (value >= 1) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 6 })}`; return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 12 })}`; }

export function classifyPostAlertReversal(outcome: Outcome): 'WEAKENING' | 'DANGER' | null {
  if (String(outcome.status).toUpperCase() !== 'MEASURED' || Number(outcome.checkpoint_seconds) < 60) return null;
  const peakRoi = finite(outcome.peak_roi), currentRoi = finite(outcome.current_roi), drawdown = finite(outcome.max_drawdown);
  if (peakRoi == null || currentRoi == null || drawdown == null || peakRoi < MIN_PEAK_ROI) return null;
  if (drawdown >= DANGER_DRAWDOWN || currentRoi <= 0) return 'DANGER';
  if (drawdown >= WEAKENING_DRAWDOWN) return 'WEAKENING';
  return null;
}

function renderReversal(event: AlertEvent, outcome: Outcome, state: 'WEAKENING' | 'DANGER'): string {
  const peakRoi = finite(outcome.peak_roi) ?? 0, currentRoi = finite(outcome.current_roi) ?? 0, drawdown = finite(outcome.max_drawdown) ?? 0;
  const heading = state === 'DANGER' ? '🚨 TREND REVERSAL · HIGH RISK' : '⚠️ TREND REVERSAL · PROTECT PROFIT';
  const view = state === 'DANGER' ? 'The post-alert move has materially broken down. Do not treat this as a new entry. If exposed, review the position and protect capital.' : 'Momentum has materially retraced from its verified post-alert peak. Avoid chasing and protect profit if exposed.';
  return [`<b>${heading}</b>`, '', `<b>${html(event.symbol ?? event.asset_id)}</b>`, `Peak since alert  <b>+${peakRoi.toFixed(1)}%</b>`, `Current return    <b>${currentRoi >= 0 ? '+' : ''}${currentRoi.toFixed(1)}%</b>`, `Drawdown from peak <b>-${drawdown.toFixed(1)}%</b>`, `Current price     <b>${money(finite(outcome.current_price))}</b>`, '', '<b>AlphaOS View</b>', view].join('\n');
}

async function processEvent(event: AlertEvent, outcome: Outcome): Promise<void> {
  const state = classifyPostAlertReversal(outcome); if (!state) return;
  const identity = `post-alert-reversal:${event.id}:${state}:v1`;
  const record = await persistOrLoadAlphaSemanticEventRecord({ identity, type: state as AlphaSemanticEventType, assetId: event.asset_id, chain: event.chain, strategyKey: event.strategy_key, symbol: event.symbol, intelligenceState: state, alertedAt: outcome.measured_at, rawSnapshot: { sourceAlertEventId: event.id, sourceAlertIdentity: event.event_identity, sourceSemanticType: event.semantic_event_type, checkpointSeconds: outcome.checkpoint_seconds, currentRoi: finite(outcome.current_roi), peakRoi: finite(outcome.peak_roi), maxDrawdown: finite(outcome.max_drawdown), currentPrice: finite(outcome.current_price), peakPrice: finite(outcome.peak_price), priceProvenance: outcome.price_provenance, capitalProtectionOnly: true, positiveEntryRecommendation: false } });
  const result = await deliverAlphaSemanticEvent({ event: { id: record.id, eventIdentity: record.event_identity, type: state, assetId: event.asset_id, chain: event.chain, strategyKey: event.strategy_key }, message: renderReversal(event, outcome, state), preserveMessage: true });
  if (result.delivered > 0) console.log('[PostAlertLifecycle] reversal delivered', { sourceAlertEventId: event.id, token: event.asset_id, symbol: event.symbol, state, delivered: result.delivered });
}

let running = false;
export async function runPostAlertLifecycleCycle(now = new Date()): Promise<void> {
  if (running) return; running = true;
  try {
    const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const deliveryResult = await supabase.from('alpha_alert_event_deliveries').select('alert_event_id,delivered_at').not('delivered_at', 'is', null).gte('delivered_at', since).order('delivered_at', { ascending: false }).limit(1000);
    if (deliveryResult.error) throw deliveryResult.error;
    const eventIds = [...new Set((deliveryResult.data ?? []).map(row => Number(row.alert_event_id)).filter(Number.isFinite))]; if (!eventIds.length) return;
    const [eventsResult, outcomesResult] = await Promise.all([
      supabase.from('alpha_alert_events').select('id,event_identity,asset_id,chain,symbol,strategy_key,semantic_event_type,alerted_at').in('id', eventIds),
      supabase.from('alpha_alert_outcomes').select('alert_event_id,checkpoint_seconds,current_roi,peak_roi,max_drawdown,current_price,peak_price,price_provenance,measured_at,status').in('alert_event_id', eventIds).eq('status', 'MEASURED').order('checkpoint_seconds', { ascending: false }),
    ]);
    if (eventsResult.error) throw eventsResult.error; if (outcomesResult.error) throw outcomesResult.error;
    const latestOutcome = new Map<number, Outcome>();
    for (const row of (outcomesResult.data ?? []) as Outcome[]) { const id = Number(row.alert_event_id); if (!latestOutcome.has(id)) latestOutcome.set(id, row); }
    for (const event of (eventsResult.data ?? []) as AlertEvent[]) { if (!SOURCE_TYPES.has(String(event.semantic_event_type ?? '').toUpperCase())) continue; const outcome = latestOutcome.get(Number(event.id)); if (!outcome) continue; await processEvent(event, outcome).catch(error => console.warn('[PostAlertLifecycle] event failed', { alertEventId: event.id, reason: error instanceof Error ? error.message : String(error) })); }
  } finally { running = false; }
}

let started = false;
export function startPostAlertLifecycleService(): void {
  if (started) return; started = true;
  console.log('[PostAlertLifecycle] Started. Existing BOOST generation/delivery is unchanged.');
  const run = () => void runPostAlertLifecycleCycle().catch(error => console.warn('[PostAlertLifecycle] cycle failed', { reason: error instanceof Error ? error.message : String(error) }));
  run(); const timer = setInterval(run, POLL_MS); timer.unref?.();
}
