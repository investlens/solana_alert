import { supabase } from './supabase.js';
import { normalizeCoreDecisionMetrics, normalizeNotificationMarketContext, verifiedPonsPreIndexValuation } from '../ui/notificationMarketContext.js';

export type AlphaSemanticEventType = 'DEX_PAID' | 'BOOST' | 'VOLUME_SURGE' | 'BUILDING' | 'CONFIRMED' | 'RUNNER' | 'COOLING' | 'WEAKENING' | 'DANGER' | 'DEV_TRANSFER' | 'DEV_SELL' | 'DEV_BURN' | 'LIQUIDITY_RISK' | 'WALLET_CLUSTER' | 'RUNNER_50' | 'RUNNER_100' | 'ATH_OBSERVATION' | 'NEW_ATH' | 'X_REPUTED_MENTION' | 'PONS_PROVEN_DEV_LAUNCH';

const OUTCOME_PRICE_TYPES = new Set<AlphaSemanticEventType>([
  'DEX_PAID',
  'BOOST',
  'VOLUME_SURGE',
  'DEV_BURN',
  'DEV_SELL',
  'LIQUIDITY_RISK',
  'PONS_PROVEN_DEV_LAUNCH',
]);

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

async function ensureVerifiedOutcomeEntryPrice(args: {
  type: AlphaSemanticEventType;
  assetId: string;
  chain: string;
  rawSnapshot: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const raw = structuredClone(args.rawSnapshot);
  if (!OUTCOME_PRICE_TYPES.has(args.type)) return raw;
  if (resolveVerifiedSemanticEntryPrice(raw, args.assetId).price != null) return raw;

  const chain = args.chain.toLowerCase();
  if (!['robinhood', 'pons'].includes(chain)) return raw;

  try {
    const { getRobinhoodMarketSnapshot } = await import('../chains/robinhood/market.js');
    const market = await getRobinhoodMarketSnapshot(args.assetId, {
      priority: 'HIGH',
      caller: 'alpha_entry_price_capture',
    });
    const price = Number(market?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) return raw;

    return {
      ...raw,
      priceUsd: price,
      priceProvenance: 'DEXSCREENER_VERIFIED_BASE_PAIR',
      marketIndexState: 'VERIFIED',
    };
  } catch (error) {
    console.warn('[AlphaEntryPrice] Verified price capture failed; preserving event without fabricated price', {
      assetId: args.assetId,
      type: args.type,
      reason: error instanceof Error ? error.message : String(error),
    });
    return raw;
  }
}

export async function persistAlphaSemanticEvent(args: {
  identity: string; type: AlphaSemanticEventType; assetId: string; chain: string;
  intelligenceState?: string | null; strategyKey?: string | null; symbol?: string | null;
  rawSnapshot: Record<string, unknown>; alertedAt?: string;
}): Promise<boolean> {
  return Boolean(await persistAlphaSemanticEventRecord(args));
}

export async function persistAlphaSemanticEventRecord(args: {
  identity: string; type: AlphaSemanticEventType; assetId: string; chain: string;
  intelligenceState?: string | null; strategyKey?: string | null; symbol?: string | null;
  rawSnapshot: Record<string, unknown>; alertedAt?: string;
}): Promise<{ id: number; event_identity: string } | null> {
  const alertedAt = args.alertedAt ?? new Date().toISOString();
  const rawSnapshot = await ensureVerifiedOutcomeEntryPrice(args);
  const event = buildAlphaSemanticEvent({ ...args, rawSnapshot }, alertedAt);
  const { data, error } = await supabase.from('alpha_alert_events').upsert(event,
    { onConflict: 'event_identity', ignoreDuplicates: true }).select('id,event_identity').maybeSingle();
  if (error) throw error;
  return data ? { id: Number(data.id), event_identity: String(data.event_identity) } : null;
}

export async function persistOrLoadAlphaSemanticEventRecord(args: {
  identity: string; type: AlphaSemanticEventType; assetId: string; chain: string;
  intelligenceState?: string | null; strategyKey?: string | null; symbol?: string | null;
  rawSnapshot: Record<string, unknown>; alertedAt?: string;
}): Promise<{ id: number; event_identity: string }> {
  const inserted = await persistAlphaSemanticEventRecord(args);
  if (inserted) return inserted;
  const eventIdentity = `v2:${args.type}:${args.identity}`;
  const { data, error } = await supabase.from('alpha_alert_events').select('id,event_identity')
    .eq('event_identity', eventIdentity).single();
  if (error) throw error;
  return { id: Number(data.id), event_identity: String(data.event_identity) };
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
