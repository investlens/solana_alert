import { boundedAlphaText, compactAlphaAddress, escapeAlphaHtml, TELEGRAM_MESSAGE_LIMIT } from '../ui/alphaNotification.js';
import { compareVerifiedPrices } from './priceComparability.js';

export type ComparableAlertEvent = { id: number; alerted_at: string; asset_id?: string | null; symbol?: string | null; token_name?: string | null;
  opportunity_id?: number | null; delivery_identity?: string | null; lifecycle_action?: string | null;
  semantic_event_type?: string | null; alert_type?: string | null;
  intelligence_state?: string | null; price?: number | string | null; price_provenance?: string | null;
  chain?: string | null; market_index_state?: string | null; raw_snapshot?: Record<string, unknown> | null;
  market_cap?: number | string | null; liquidity?: number | string | null; volume_5m?: number | string | null };
export type MetricComparison = { previous: number; current: number; changePct: number };
export type AlertComparison = { hasPriorAlert: boolean; previousEventId?: number; previousObservedAt?: string;
  price?: MetricComparison; marketCap?: MetricComparison; liquidity?: MetricComparison; volume5m?: MetricComparison;
  previousState?: string; currentState?: string; newAth?: boolean; symbol?: string; name?: string; address?: string;
  historyStatus?: 'AVAILABLE' | 'UNAVAILABLE'; elapsedSincePriorMs?: number;
  drawdownFromPriorStructuralPricePct?: number; participation?: { previousBuys: number; currentBuys: number; currentSells: number } };

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
  if (!ACTIONABLE_TYPES.has(currentType) && !['BUY', 'CHECK_ENTRY'].includes(currentAction)) return { hasPriorAlert: false, historyStatus: 'AVAILABLE', currentState: current.intelligence_state ?? undefined, ...identity };
  if (!previous) return { hasPriorAlert: false, historyStatus: 'AVAILABLE', currentState: current.intelligence_state ?? undefined, ...identity };
  const raw = (row: ComparableAlertEvent, key: string) => Number(row.raw_snapshot?.[key] ?? (row.raw_snapshot?._alertContext as Record<string, unknown> | undefined)?.[key]);
  const price = compareVerifiedPrices(
    { chain: previous.chain, token: previous.asset_id, price: previous.price, provenance: previous.price_provenance,
      quote: String(previous.raw_snapshot?.priceQuote ?? previous.raw_snapshot?.quoteAsset ?? ''), marketIndexState: previous.market_index_state },
    { chain: current.chain, token: current.asset_id, price: current.price, provenance: current.price_provenance,
      quote: String(current.raw_snapshot?.priceQuote ?? current.raw_snapshot?.quoteAsset ?? ''), marketIndexState: current.market_index_state },
  );
  const previousBuys = raw(previous, 'buys5m'), currentBuys = raw(current, 'buys5m'), currentSells = raw(current, 'sells5m');
  return { hasPriorAlert: true, previousEventId: previous.id, previousObservedAt: previous.alerted_at,
    historyStatus: 'AVAILABLE', elapsedSincePriorMs: Math.max(0, Date.parse(current.alerted_at) - Date.parse(previous.alerted_at)),
    price: price.comparable ? { previous: price.previous, current: price.current, changePct: price.changePct } : undefined,
    marketCap: compareVerifiedMetric(previous.market_cap, current.market_cap), liquidity: compareVerifiedMetric(previous.liquidity, current.liquidity),
    volume5m: compareVerifiedMetric(previous.volume_5m, current.volume_5m), previousState: previous.intelligence_state ?? undefined,
    currentState: current.intelligence_state ?? undefined,
    participation: [previousBuys, currentBuys, currentSells].every(Number.isFinite)
      ? { previousBuys, currentBuys, currentSells } : undefined, ...identity };
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
  const fields = 'id,opportunity_id,delivery_identity,lifecycle_action,alerted_at,asset_id,chain,symbol,token_name,semantic_event_type,alert_type,intelligence_state,price,price_provenance,market_index_state,market_cap,liquidity,volume_5m,raw_snapshot';
  const { data: current, error: currentError } = await supabase.from('alpha_alert_events').select(fields).eq('id', args.currentEventId).maybeSingle();
  if (currentError) throw currentError;
  if (!current) return { hasPriorAlert: false, historyStatus: 'UNAVAILABLE' };
  const { data: candidates, error } = await supabase.from('alpha_alert_events').select(fields)
    .eq('chain', args.chain.toLowerCase()).ilike('asset_id', args.assetId).lt('alerted_at', current.alerted_at).order('alerted_at', { ascending: false }).limit(100);
  if (error) throw error;
  const positiveCandidates = (candidates ?? []).filter(row => ACTIONABLE_TYPES.has(String(row.semantic_event_type ?? row.alert_type ?? '').toUpperCase()) ||
    ['BUY', 'CHECK_ENTRY'].includes(String(row.lifecycle_action ?? '').toUpperCase()));
  const structuralPrices = (candidates ?? []).flatMap(row => {
    const result = compareVerifiedPrices(
      { chain: row.chain, token: row.asset_id, price: row.price, provenance: row.price_provenance,
        quote: String(row.raw_snapshot?.priceQuote ?? row.raw_snapshot?.quoteAsset ?? ''), marketIndexState: row.market_index_state },
      { chain: current.chain, token: current.asset_id, price: current.price, provenance: current.price_provenance,
        quote: String(current.raw_snapshot?.priceQuote ?? current.raw_snapshot?.quoteAsset ?? ''), marketIndexState: current.market_index_state },
    );
    return result.comparable ? [result.previous] : [];
  });
  const withDrawdown = (comparison: AlertComparison): AlertComparison => {
    const currentPrice = positive(current.price);
    const reference = structuralPrices.length ? Math.max(...structuralPrices) : null;
    return { ...comparison, drawdownFromPriorStructuralPricePct: currentPrice != null && reference != null
      ? ((currentPrice - reference) / reference) * 100 : undefined };
  };
  if (!positiveCandidates.length) return withDrawdown(buildAlertComparison(null, current as ComparableAlertEvent));
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
  return withDrawdown(buildAlertComparison(previous as ComparableAlertEvent | null, current as ComparableAlertEvent));
}
