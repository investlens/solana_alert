import { normalizeCoreDecisionMetrics, normalizeNotificationMarketContext, verifiedPonsPreIndexValuation } from '../ui/notificationMarketContext.js';
import { opportunityDeliveryIdentity } from './opportunityDeliveryIdentity.js';
import { supabase } from './supabase.js';

export type AlphaLedgerOpportunity = {
  id: number; asset_id: string; chain: string | null; strategy_key: string | null;
  recommended_action: string | null; status: string; title: string | null; why: string | null;
  what_happened: string | null; invalidation: string | null; risk_reason: string | null;
  confidence: number | null; risk_score: number | null; raw_data: Record<string, unknown> | null;
};

const finite = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export function alphaAlertEventIdentity(opportunity: AlphaLedgerOpportunity): string {
  return `v1:opportunity:${opportunity.id}:${opportunityDeliveryIdentity({
    action: opportunity.recommended_action, status: opportunity.status,
  })}`;
}

export function buildAlphaAlertEvent(opportunity: AlphaLedgerOpportunity, alertedAt = new Date().toISOString()) {
  const raw = structuredClone(opportunity.raw_data ?? {});
  const market = normalizeNotificationMarketContext(raw, { address: opportunity.asset_id });
  const core = normalizeCoreDecisionMetrics(raw);
  const preIndex = verifiedPonsPreIndexValuation(raw, opportunity.asset_id);
  const indexed = String(raw.marketIndexState ?? '') === 'VERIFIED';
  const action = String(opportunity.recommended_action ?? '').toUpperCase();
  const price = finite(raw.priceWhenVerified ?? raw.priceUsd ?? raw.currentPrice ?? raw.price);
  const valuationType = market.marketCap != null ? 'MARKET_CAP' : market.fdv != null ? 'FDV' : null;
  const created = new Date(String(raw.createdAt ?? raw.detectedAt ?? raw.firstSeenAt ?? '')).getTime();
  const elapsed = Number.isFinite(created) ? Math.max(0, Math.floor((new Date(alertedAt).getTime() - created) / 1000)) : null;
  return {
    event_identity: alphaAlertEventIdentity(opportunity), opportunity_id: opportunity.id,
    asset_id: opportunity.asset_id, chain: String(opportunity.chain ?? 'unknown').toLowerCase(),
    strategy_key: opportunity.strategy_key, lifecycle_action: action, lifecycle_state: opportunity.status,
    alert_type: action === 'EXIT' ? 'RISK' : action === 'BUY' ? 'ENTRY' : 'CHECK_ENTRY',
    delivery_identity: opportunityDeliveryIdentity({ action, status: opportunity.status }),
    symbol: market.symbol, token_name: market.name, confidence: opportunity.confidence,
    risk_score: opportunity.risk_score, risk_label: text(raw.riskLabel ?? raw.risk),
    reason: opportunity.why ?? opportunity.risk_reason ?? opportunity.what_happened,
    current_roi: finite(raw.currentRoi ?? raw.roi), roi_change: finite(raw.roiChange ?? raw.momentum),
    price, price_provenance: text(raw.priceProvenance ?? raw.priceSource ?? raw.tokenPriceSource),
    market_cap: market.marketCap, fdv: market.fdv, valuation_type: valuationType,
    valuation_provenance: indexed ? text((raw.verifiedMarketContext as Record<string, unknown> | undefined)?.source) ?? 'VERIFIED_MARKET_INDEX' : preIndex ? 'PONS_V2_CURVE_RESERVE_SPOT' : null,
    liquidity: market.liquidity, volume_5m: market.volume5m,
    market_index_state: text(raw.marketIndexState), chart_available: Boolean(market.chartUrl), elapsed_seconds: elapsed,
    dev_holding_percent: core.devHoldingPercent, dev_holding_evidence: core.devHoldingEvidence,
    dev_holding_source: text(raw.devHoldingSource), burned_percent: core.burnedPercent,
    burn_evidence: core.burnEvidence, burn_source: text(raw.burnSource),
    developer_transferred_percent: finite(raw.otherDevTransferPercent),
    boost_total: finite(raw.totalBoostAmount ?? raw.boostTotal), boost_increment: finite(raw.boostAmount ?? raw.boostIncrement),
    creator_evidence: (raw.creatorEvidence ?? raw.creatorTrust ?? null) as object | null,
    risk_evidence: (raw.emergencyExit ?? raw.criticalRisk ?? null) as object | null,
    raw_snapshot: {
      ...raw,
      _alertContext: {
        opportunityId: opportunity.id, assetId: opportunity.asset_id, chain: opportunity.chain,
        strategyKey: opportunity.strategy_key, lifecycleAction: action, lifecycleState: opportunity.status,
        title: opportunity.title, why: opportunity.why, whatHappened: opportunity.what_happened,
        invalidation: opportunity.invalidation, riskReason: opportunity.risk_reason,
        confidence: opportunity.confidence, riskScore: opportunity.risk_score,
        market, coreEvidence: core, alertedAt,
      },
    },
    alerted_at: alertedAt,
  };
}

export async function persistAlphaAlertEvent(opportunity: AlphaLedgerOpportunity) {
  const event = buildAlphaAlertEvent(opportunity);
  const { data, error } = await supabase.from('alpha_alert_events').upsert(event, {
    onConflict: 'event_identity', ignoreDuplicates: true,
  }).select('id,event_identity').maybeSingle();
  if (error) throw error;
  return data;
}
