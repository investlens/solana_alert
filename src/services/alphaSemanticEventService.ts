import { supabase } from './supabase.js';
import { normalizeCoreDecisionMetrics, normalizeNotificationMarketContext, verifiedPonsPreIndexValuation } from '../ui/notificationMarketContext.js';

export type AlphaSemanticEventType = 'DEX_PAID' | 'BOOST' | 'VOLUME_SURGE' | 'BUILDING' | 'CONFIRMED' | 'RUNNER' | 'COOLING' | 'WEAKENING' | 'DANGER' | 'DEV_TRANSFER' | 'DEV_SELL' | 'DEV_BURN' | 'LIQUIDITY_RISK' | 'WALLET_CLUSTER';

export function resolveVerifiedSemanticEntryPrice(
  raw: Record<string, unknown>,
  assetId: string,
): { price: number | null; provenance: string | null } {
  const explicitProvenance = typeof raw.priceProvenance === 'string' && raw.priceProvenance.trim()
    ? raw.priceProvenance.trim()
    : typeof raw.priceSource === 'string' && raw.priceSource.trim()
      ? raw.priceSource.trim()
      : typeof raw.tokenPriceSource === 'string' && raw.tokenPriceSource.trim()
        ? raw.tokenPriceSource.trim()
        : null;
  const explicitValue = Number(raw.priceWhenVerified ?? raw.priceUsd ?? raw.price ?? raw.currentPrice);
  if (explicitProvenance && Number.isFinite(explicitValue) && explicitValue > 0) {
    return { price: explicitValue, provenance: explicitProvenance };
  }

  const preIndex = verifiedPonsPreIndexValuation(raw, assetId);
  const preIndexRaw = raw.preIndexValuation as Record<string, unknown> | null | undefined;
  const preIndexPrice = Number(preIndexRaw?.tokenPriceUsd);
  if (preIndex && Number.isFinite(preIndexPrice) && preIndexPrice > 0 &&
      preIndexRaw?.tokenPriceSource === 'PONS_V2_CURVE_RESERVE_RATIO') {
    return { price: preIndexPrice, provenance: 'PONS_V2_CURVE_RESERVE_RATIO' };
  }
  return { price: null, provenance: null };
}

export async function persistAlphaSemanticEvent(args: {
  identity: string; type: AlphaSemanticEventType; assetId: string; chain: string;
  intelligenceState?: string | null; strategyKey?: string | null; symbol?: string | null;
  rawSnapshot: Record<string, unknown>; alertedAt?: string;
}): Promise<boolean> {
  const alertedAt = args.alertedAt ?? new Date().toISOString();
  const event = buildAlphaSemanticEvent(args, alertedAt);
  const { data, error } = await supabase.from('alpha_alert_events').upsert(event,
    { onConflict: 'event_identity', ignoreDuplicates: true }).select('id').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export function buildAlphaSemanticEvent(args: {
  identity: string; type: AlphaSemanticEventType; assetId: string; chain: string;
  intelligenceState?: string | null; strategyKey?: string | null; symbol?: string | null;
  rawSnapshot: Record<string, unknown>;
}, alertedAt = new Date().toISOString()) {
  const raw = structuredClone(args.rawSnapshot);
  const market = normalizeNotificationMarketContext(raw, { address: args.assetId });
  const core = normalizeCoreDecisionMetrics(raw);
  const entryPrice = resolveVerifiedSemanticEntryPrice(raw, args.assetId);
  return {
    event_identity: `v2:${args.type}:${args.identity}`, opportunity_id: null,
    asset_id: args.assetId, chain: args.chain.toLowerCase(), strategy_key: args.strategyKey ?? null,
    lifecycle_action: 'OBSERVE', lifecycle_state: args.intelligenceState ?? 'EVENT',
    alert_type: args.type, semantic_event_type: args.type, intelligence_state: args.intelligenceState ?? null,
    symbol: args.symbol ?? market.symbol ?? null, token_name: market.name,
    price: entryPrice.price, price_provenance: entryPrice.provenance,
    market_cap: market.marketCap, fdv: market.fdv, valuation_type: market.marketCap != null ? 'MARKET_CAP' : market.fdv != null ? 'FDV' : null,
    liquidity: market.liquidity, volume_5m: market.volume5m,
    dev_holding_percent: core.devHoldingPercent, dev_holding_evidence: core.devHoldingEvidence,
    burned_percent: core.burnedPercent, burn_evidence: core.burnEvidence,
    boost_total: Number.isFinite(Number(raw.boostTotal)) ? Number(raw.boostTotal) : null,
    boost_increment: Number.isFinite(Number(raw.boostIncrement)) ? Number(raw.boostIncrement) : null,
    chart_available: Boolean(raw.chartUrl), raw_snapshot: raw, alerted_at: alertedAt,
  };
}
