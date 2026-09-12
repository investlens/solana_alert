import { supabase } from '../../services/supabase.js';

const MAX_PONS_LAUNCH_AGE_MS = 10 * 60 * 1000;
const CACHE_MS = 30_000;
const REFRESH_TIMEOUT_MS = 1_500;

const cache = new Map<string, { expiresAt: number; value: boolean }>();
const inFlight = new Map<string, Promise<boolean>>();

async function resolveAndPersist(tokenAddress: string): Promise<boolean> {
  const { data: launch, error: launchError } = await supabase
    .from('pons_shadow_trades')
    .select('token_address,launch_version,curve_address,detected_at')
    .ilike('token_address', tokenAddress)
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (launchError) throw launchError;
  if (launch?.launch_version !== 'V2' || !launch.curve_address) return false;

  const detectedAt = new Date(String(launch.detected_at ?? '')).getTime();
  const ageMs = Date.now() - detectedAt;
  if (!Number.isFinite(detectedAt) || ageMs < 0 || ageMs > MAX_PONS_LAUNCH_AGE_MS) return false;

  // Dynamic imports avoid a module-initialization cycle because the PONS valuation
  // resolver itself obtains the quote-asset USD price through market.ts.
  const [{ getPonsV2CurveState }, { resolvePonsV2PreIndexValuation }] = await Promise.all([
    import('./ponsV2CurveQuote.js'),
    import('./ponsPreIndexValuation.js'),
  ]);

  const curveState = await getPonsV2CurveState(String(launch.curve_address));
  const valuation = await resolvePonsV2PreIndexValuation(curveState);
  if (!valuation) return false;

  const { data: opportunity, error: opportunityError } = await supabase
    .from('opportunities')
    .select('id,raw_data')
    .eq('asset_id', tokenAddress)
    .eq('chain', 'robinhood')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (opportunityError) throw opportunityError;
  if (!opportunity?.id) return false;

  const rawData = (opportunity.raw_data as Record<string, unknown> | null) ?? {};
  const nextRawData = {
    ...rawData,
    preIndexValuation: valuation,
    valuationEvidenceRefreshedAt: new Date().toISOString(),
    valuationEvidenceSource: valuation.source,
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
