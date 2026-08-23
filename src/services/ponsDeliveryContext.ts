import { resolveTokenOpenTarget, type TokenOpenTarget } from '../core/tokenOpenRouter.js';
import { hasVerifiedOpportunityIdentity, mergePonsLifecycleContext } from '../product/opportunityContext.js';
import { normalizeNotificationMarketContext } from '../ui/notificationMarketContext.js';
import { supabase } from './supabase.js';

type DeliveryOpportunity = {
  asset_id: string;
  chain: string | null;
  raw_data: Record<string, unknown> | null;
};

type ResolverDependencies = {
  loadLifecycleIdentity: (opportunity: DeliveryOpportunity) => Promise<Record<string, unknown> | null>;
  loadObservationIdentity: (opportunity: DeliveryOpportunity) => Promise<Record<string, unknown> | null>;
  resolveTarget: typeof resolveTokenOpenTarget;
};

async function loadLifecycleIdentity(opportunity: DeliveryOpportunity) {
  const { data, error } = await supabase
    .from('opportunities')
    .select('raw_data')
    .eq('asset_id', opportunity.asset_id)
    .eq('chain', opportunity.chain)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? [])
    .map(row => row.raw_data as Record<string, unknown> | null)
    .find(hasVerifiedOpportunityIdentity) ?? null;
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

const defaults: ResolverDependencies = {
  loadLifecycleIdentity,
  loadObservationIdentity,
  resolveTarget: resolveTokenOpenTarget,
};

export async function resolvePonsDeliveryContext(
  opportunity: DeliveryOpportunity,
  dependencies: Partial<ResolverDependencies> = {},
): Promise<{ rawData: Record<string, unknown>; target: TokenOpenTarget }> {
  const deps = { ...defaults, ...dependencies };
  let rawData = opportunity.raw_data ?? {};

  if (!hasVerifiedOpportunityIdentity(rawData)) {
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
  return { rawData, target };
}
