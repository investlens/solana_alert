import { resolveTokenOpenTarget, type TokenOpenTarget } from '../core/tokenOpenRouter.js';
import { hasVerifiedOpportunityIdentity, mergePonsLifecycleContext } from '../product/opportunityContext.js';
import {
  normalizeNotificationMarketContext,
  PONS_PREINDEX_LIFECYCLE_MAX_AGE_MS,
  verifiedPonsPreIndexValuation,
} from '../ui/notificationMarketContext.js';
import { getPonsV2CurveState } from '../chains/robinhood/ponsV2CurveQuote.js';
import { resolvePonsV2PreIndexValuation } from '../chains/robinhood/ponsPreIndexValuation.js';
import { supabase } from './supabase.js';

type DeliveryOpportunity = {
  asset_id: string;
  chain: string | null;
  raw_data: Record<string, unknown> | null;
};

type ResolverDependencies = {
  loadLifecycleIdentity: (opportunity: DeliveryOpportunity) => Promise<Record<string, unknown> | null>;
  loadObservationIdentity: (opportunity: DeliveryOpportunity) => Promise<Record<string, unknown> | null>;
  loadPreIndexValuation: (opportunity: DeliveryOpportunity) => Promise<Record<string, unknown> | null>;
  resolveTarget: typeof resolveTokenOpenTarget;
};

async function loadLifecycleContext(opportunity: DeliveryOpportunity) {
  const { data, error } = await supabase
    .from('opportunities')
    .select('raw_data')
    .eq('asset_id', opportunity.asset_id)
    .eq('chain', opportunity.chain)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const contexts = (data ?? []).map(row => row.raw_data as Record<string, unknown> | null);
  const valuation = contexts.find(rawData =>
    verifiedPonsPreIndexValuation(rawData, opportunity.asset_id) != null) ?? null;
  const identity = contexts.find(hasVerifiedOpportunityIdentity) ?? null;
  if (valuation && identity && valuation !== identity) {
    return mergePonsLifecycleContext(identity, valuation);
  }
  return valuation ?? identity;
}

async function loadObservationIdentity(opportunity: DeliveryOpportunity) {
  const { data, error } = await supabase
    .from('robinhood_observations')
    .select('symbol,name,decision_at,source')
    .eq('token_address', opportunity.asset_id.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  const context = normalizeNotificationMarketContext(data as Record<string, unknown> | null);
  if (!context.symbol && !context.name) return null;
  return {
    symbol: context.symbol,
    name: context.name,
    identityVerifiedAt: data?.decision_at ?? new Date().toISOString(),
    identitySource: data?.source ?? 'ROBINHOOD_OBSERVATION',
  };
}

async function loadCurrentPonsV2Valuation(opportunity: DeliveryOpportunity) {
  const { data, error } = await supabase
    .from('pons_shadow_trades')
    .select('token_address,launch_version,curve_address,detected_at')
    .ilike('token_address', opportunity.asset_id)
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data?.launch_version !== 'V2' || !data.curve_address) return null;
  const detectedAt = new Date(String(data.detected_at ?? '')).getTime();
  const age = Date.now() - detectedAt;
  if (!Number.isFinite(detectedAt) || age < 0 || age > PONS_PREINDEX_LIFECYCLE_MAX_AGE_MS) return null;
  const curveState = await getPonsV2CurveState(data.curve_address);
  const valuation = await resolvePonsV2PreIndexValuation(curveState);
  return valuation ? { preIndexValuation: valuation } : null;
}

const defaults: ResolverDependencies = {
  loadLifecycleIdentity: loadLifecycleContext,
  loadObservationIdentity,
  loadPreIndexValuation: loadCurrentPonsV2Valuation,
  resolveTarget: resolveTokenOpenTarget,
};

export async function resolvePonsDeliveryContext(
  opportunity: DeliveryOpportunity,
  dependencies: Partial<ResolverDependencies> = {},
): Promise<{ rawData: Record<string, unknown>; target: TokenOpenTarget }> {
  const deps = { ...defaults, ...dependencies };
  let rawData = opportunity.raw_data ?? {};

  if (!hasVerifiedOpportunityIdentity(rawData) ||
      verifiedPonsPreIndexValuation(rawData, opportunity.asset_id) == null) {
    try {
      const lifecycle = await deps.loadLifecycleIdentity(opportunity);
      if (lifecycle) rawData = mergePonsLifecycleContext(lifecycle, rawData);
    } catch (error) {
      console.warn('[PonsDeliveryContext] Lifecycle identity lookup failed', {
        token: opportunity.asset_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!hasVerifiedOpportunityIdentity(rawData)) {
    try {
      const observation = await deps.loadObservationIdentity(opportunity);
      if (observation) rawData = mergePonsLifecycleContext(observation, rawData);
    } catch (error) {
      console.warn('[PonsDeliveryContext] Observation identity lookup failed', {
        token: opportunity.asset_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const target = await deps.resolveTarget({
    chain: opportunity.chain,
    tokenAddress: opportunity.asset_id,
    includeMetadataFallback: !hasVerifiedOpportunityIdentity(rawData),
  });

  if (target.marketIndexState !== 'VERIFIED' &&
      verifiedPonsPreIndexValuation(rawData, opportunity.asset_id) == null) {
    try {
      const valuation = await deps.loadPreIndexValuation(opportunity);
      if (valuation) rawData = mergePonsLifecycleContext(valuation, rawData);
    } catch (error) {
      console.warn('[PonsDeliveryContext] Pre-index V2 valuation unavailable', {
        token: opportunity.asset_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { rawData, target };
}
