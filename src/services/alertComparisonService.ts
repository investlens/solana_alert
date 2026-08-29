import { boundedAlphaText, compactAlphaAddress, escapeAlphaHtml, TELEGRAM_MESSAGE_LIMIT } from '../ui/alphaNotification.js';

export type ComparableAlertEvent = { id: number; alerted_at: string; asset_id?: string | null; symbol?: string | null; token_name?: string | null;
  opportunity_id?: number | null; delivery_identity?: string | null; lifecycle_action?: string | null;
  semantic_event_type?: string | null; alert_type?: string | null;
  intelligence_state?: string | null; price?: number | string | null; price_provenance?: string | null;
  market_cap?: number | string | null; liquidity?: number | string | null; volume_5m?: number | string | null };
export type MetricComparison = { previous: number; current: number; changePct: number };
export type AlertComparison = { hasPriorAlert: boolean; previousEventId?: number; previousObservedAt?: string;
  price?: MetricComparison; marketCap?: MetricComparison; liquidity?: MetricComparison; volume5m?: MetricComparison;
  previousState?: string; currentState?: string; newAth?: boolean; symbol?: string; name?: string; address?: string };

const ACTIONABLE_TYPES = new Set(['OPPORTUNITY', 'ENTRY', 'CHECK_ENTRY']);
const positive = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
export function compareVerifiedMetric(previous: unknown, current: unknown): MetricComparison | undefined {
  const a = positive(previous), b = positive(current);
  return a == null || b == null ? undefined : { previous: a, current: b, changePct: ((b - a) / a) * 100 };
}
export function buildAlertComparison(previous: ComparableAlertEvent | null, current: ComparableAlertEvent): AlertComparison {
  const identity = { symbol: current.symbol ?? undefined, name: current.token_name ?? undefined, address: current.asset_id ?? undefined };
  const currentType = String(current.semantic_event_type ?? current.alert_type ?? '').toUpperCase();
  const currentAction = String(current.lifecycle_action ?? '').toUpperCase();
  if (!ACTIONABLE_TYPES.has(currentType) && !['BUY', 'CHECK_ENTRY'].includes(currentAction)) return { hasPriorAlert: false, currentState: current.intelligence_state ?? undefined, ...identity };
  if (!previous) return { hasPriorAlert: false, currentState: current.intelligence_state ?? undefined, ...identity };
  return { hasPriorAlert: true, previousEventId: previous.id, previousObservedAt: previous.alerted_at,
    price: previous.price_provenance && current.price_provenance ? compareVerifiedMetric(previous.price, current.price) : undefined,
    marketCap: compareVerifiedMetric(previous.market_cap, current.market_cap), liquidity: compareVerifiedMetric(previous.liquidity, current.liquidity),
    volume5m: compareVerifiedMetric(previous.volume_5m, current.volume_5m), previousState: previous.intelligence_state ?? undefined,
    currentState: current.intelligence_state ?? undefined, ...identity };
}

const usd = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : value >= 1_000
  ? `$${(value / 1_000).toFixed(1)}K` : value < 1 ? `$${value.toPrecision(5).replace(/0+$/, '').replace(/\.$/, '')}` : `$${value.toFixed(2)}`;
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
export function renderMomentumUpdate(comparison: AlertComparison): string | null {
  if (!comparison.hasPriorAlert) return null;
  const identity = comparison.name && comparison.symbol ? `${boundedAlphaText(comparison.name, 60)} ($${boundedAlphaText(comparison.symbol, 32)})`
    : comparison.symbol ? `$${boundedAlphaText(comparison.symbol, 32)}` : boundedAlphaText(comparison.name ?? 'Token', 60);
  const primary = comparison.price ?? comparison.marketCap;
  const lines = [`📈 <b>MOMENTUM UPDATE — ${escapeAlphaHtml(identity)}</b>`,
    comparison.address ? `<code>${escapeAlphaHtml(compactAlphaAddress(comparison.address))}</code>` : ''];
  if (primary && Math.abs(primary.changePct) >= 5) {
    const primaryLabel = comparison.price ? 'Price' : 'Market cap';
    lines.push('', `🔥 ${primaryLabel} <b>${signed(primary.changePct)}</b> since AlphaOS alert`);
  }
  const add = (icon: string, label: string, metric: MetricComparison | undefined, threshold: number) => {
    if (metric && Math.abs(metric.changePct) >= threshold) lines.push(`${icon} ${label.padEnd(6)} ${usd(metric.previous)} → <b>${usd(metric.current)}</b> (${signed(metric.changePct)})`);
  };
  add('💰', 'Price', comparison.price, 5); add('📊', 'MC', comparison.marketCap, 5);
  add('💧', 'Liq', comparison.liquidity, 5); add('📈', 'Vol 5m', comparison.volume5m, 20);
  const stateChanged = comparison.previousState && comparison.currentState && comparison.previousState !== comparison.currentState;
  lines.push('', stateChanged ? `🚀 State advanced: <b>${escapeAlphaHtml(comparison.previousState)} → ${escapeAlphaHtml(comparison.currentState)}</b>` : '🚀 Momentum continuing',
    `🧠 State: <b>${escapeAlphaHtml(comparison.currentState ?? 'QUALIFIED')}</b>`, '', '<i>Observed just now</i>');
  const output = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return output.length <= TELEGRAM_MESSAGE_LIMIT ? output : null;
}

export async function loadPriorDeliveredAlertComparison(args: { currentEventId: number; assetId: string; chain: string }): Promise<AlertComparison> {
  const { supabase } = await import('./supabase.js');
  const fields = 'id,opportunity_id,delivery_identity,lifecycle_action,alerted_at,asset_id,symbol,token_name,semantic_event_type,alert_type,intelligence_state,price,price_provenance,market_cap,liquidity,volume_5m';
  const { data: current, error: currentError } = await supabase.from('alpha_alert_events').select(fields).eq('id', args.currentEventId).maybeSingle();
  if (currentError || !current) return { hasPriorAlert: false };
  const { data: candidates, error } = await supabase.from('alpha_alert_events').select(fields)
    .eq('chain', args.chain).ilike('asset_id', args.assetId).lt('alerted_at', current.alerted_at).order('alerted_at', { ascending: false }).limit(20);
  if (error) throw error;
  const positiveCandidates = (candidates ?? []).filter(row => ACTIONABLE_TYPES.has(String(row.semantic_event_type ?? row.alert_type ?? '').toUpperCase()) ||
    ['BUY', 'CHECK_ENTRY'].includes(String(row.lifecycle_action ?? '').toUpperCase()));
  if (!positiveCandidates.length) return buildAlertComparison(null, current as ComparableAlertEvent);
  const { data: delivered, error: deliveryError } = await supabase.from('alpha_alert_event_deliveries').select('alert_event_id')
    .in('alert_event_id', positiveCandidates.map(row => row.id)).not('delivered_at', 'is', null);
  if (deliveryError) throw deliveryError;
  const deliveredIds = new Set((delivered ?? []).map(row => Number(row.alert_event_id)));
  const opportunityIds = positiveCandidates.flatMap(row => row.opportunity_id == null ? [] : [row.opportunity_id]);
  if (opportunityIds.length) {
    const { data: opportunityDeliveries, error: opportunityError } = await supabase.from('opportunity_deliveries')
      .select('opportunity_id,delivery_identity').in('opportunity_id', opportunityIds).not('delivered_at', 'is', null);
    if (opportunityError) throw opportunityError;
    const deliveredOpportunities = new Set((opportunityDeliveries ?? []).map(row => `${row.opportunity_id}:${row.delivery_identity}`));
    for (const row of positiveCandidates) {
      if (row.opportunity_id != null && deliveredOpportunities.has(`${row.opportunity_id}:${row.delivery_identity}`)) deliveredIds.add(Number(row.id));
    }
  }
  const previous = positiveCandidates.find(row => deliveredIds.has(Number(row.id))) ?? null;
  return buildAlertComparison(previous as ComparableAlertEvent | null, current as ComparableAlertEvent);
}
