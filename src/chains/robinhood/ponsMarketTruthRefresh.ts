import { resolvePonsDeliveryContext } from '../../services/ponsDeliveryContext.js';
import { supabase } from '../../services/supabase.js';
import { verifiedPonsPreIndexValuation } from '../../ui/notificationMarketContext.js';

const CACHE_MS = 30_000;
const REFRESH_TIMEOUT_MS = 1_500;

const cache = new Map<string, { expiresAt: number; value: boolean }>();
const inFlight = new Map<string, Promise<boolean>>();

async function resolveAndPersist(tokenAddress: string): Promise<boolean> {
  const { data: opportunity, error } = await supabase
    .from('opportunities')
    .select('id,asset_id,chain,raw_data')
    .eq('asset_id', tokenAddress)
    .eq('chain', 'robinhood')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!opportunity?.id) return false;

  const resolved = await resolvePonsDeliveryContext({
    asset_id: opportunity.asset_id,
    chain: opportunity.chain,
    raw_data: (opportunity.raw_data as Record<string, unknown> | null) ?? {},
  });

  const valuation = verifiedPonsPreIndexValuation(resolved.rawData, tokenAddress);
  if (!valuation) return false;

  const nextRawData = {
    ...resolved.rawData,
    valuationEvidenceRefreshedAt: new Date().toISOString(),
    valuationEvidenceSource: 'PONS_DELIVERY_CONTEXT',
  };

  const { error: updateError } = await supabase
    .from('opportunities')
    .update({ raw_data: nextRawData })
    .eq('id', opportunity.id);

  if (updateError) throw updateError;
  return true;
}

export async function refreshPonsMarketTruthForAlert(tokenAddress: string): Promise<boolean> {
  const key = tokenAddress.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const work = resolveAndPersist(tokenAddress)
    .catch((error) => {
      console.warn('[PonsMarketTruthRefresh] Valuation refresh unavailable:', {
        token: tokenAddress,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    })
    .then((value) => {
      cache.set(key, { expiresAt: Date.now() + CACHE_MS, value });
      return value;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, work);

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), REFRESH_TIMEOUT_MS);
    work.then((value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}
