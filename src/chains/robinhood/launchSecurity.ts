import { supabase } from '../../services/supabase.js';
import {
  evaluatePositiveAlertSecurity,
  type LaunchClassification,
  type PositiveAlertSecurityDecision,
} from '../../security/positiveAlertSecurity.js';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const RECENT_PONS_CACHE_MS = 5 * 60_000;
const RECENT_PONS_CACHE_HOURS = 2;
const RECENT_PONS_CACHE_LIMIT = 1_500;
let recentPonsTokens = new Set<string>();
let recentPonsCacheAt = 0;
let recentPonsRefresh: Promise<void> | null = null;

export function rememberAuthoritativePonsToken(tokenAddress: string): void {
  const token = normalize(tokenAddress);
  if (token) recentPonsTokens.add(token);
}

async function refreshRecentPonsCache(): Promise<void> {
  if (recentPonsRefresh) return recentPonsRefresh;
  recentPonsRefresh = (async () => {
    try {
      const cutoff = new Date(Date.now() - RECENT_PONS_CACHE_HOURS * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('pons_launches')
        .select('token_address')
        .eq('chain', 'robinhood')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(RECENT_PONS_CACHE_LIMIT);
      if (error) throw error;
      const next = new Set<string>(recentPonsTokens);
      for (const row of data ?? []) {
        const token = normalize(String(row.token_address ?? ''));
        if (token) next.add(token);
      }
      recentPonsTokens = next;
      recentPonsCacheAt = Date.now();
      console.log('[RobinhoodLaunchSecurity] Recent PONS census refreshed.', {
        cachedTokens: recentPonsTokens.size,
        lookbackHours: RECENT_PONS_CACHE_HOURS,
      });
    } catch (error) {
      recentPonsCacheAt = Date.now();
      console.warn('[RobinhoodLaunchSecurity] Recent PONS cache refresh failed; retaining last-good census.', {
        cachedTokens: recentPonsTokens.size,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      recentPonsRefresh = null;
    }
  })();
  return recentPonsRefresh;
}

type PonsFactoryVerification = 'PONS' | 'NOT_PONS' | 'UNAVAILABLE';

async function verifyPonsAcrossKnownFactories(tokenAddress: string): Promise<PonsFactoryVerification> {
  try {
    const { getPonsLaunchState } = await import('./ponsLaunchState.js');
    const state = await getPonsLaunchState(tokenAddress);
    if (!state.exists || normalize(state.token) !== normalize(tokenAddress)) return 'NOT_PONS';
    rememberAuthoritativePonsToken(tokenAddress);
    console.log('[RobinhoodLaunchSecurity] PONS identity verified across known factories.', {
      token: normalize(tokenAddress),
      deployer: state.deployer,
      launchConfigId: state.launchConfigId.toString(),
    });
    return 'PONS';
  } catch (error) {
    console.warn('[RobinhoodLaunchSecurity] Known-factory PONS verification unavailable.', {
      token: normalize(tokenAddress),
      reason: error instanceof Error ? error.message : String(error),
    });
    return 'UNAVAILABLE';
  }
}

export async function classifyRobinhoodLaunch(tokenAddress: string): Promise<LaunchClassification> {
  const token = normalize(tokenAddress);

  if (recentPonsTokens.has(token)) return 'PONS';
  if (Date.now() - recentPonsCacheAt >= RECENT_PONS_CACHE_MS) {
    await refreshRecentPonsCache();
  }
  if (recentPonsTokens.has(token)) return 'PONS';

  let databaseAvailable = true;
  try {
    const { data, error } = await supabase
      .from('pons_launches')
      .select('id')
      .eq('chain', 'robinhood')
      .eq('token_address', token)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      rememberAuthoritativePonsToken(token);
      return 'PONS';
    }
  } catch (error) {
    databaseAvailable = false;
    console.warn('[RobinhoodLaunchSecurity] Exact PONS provenance lookup unavailable.', {
      token,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const factoryVerification = await verifyPonsAcrossKnownFactories(tokenAddress);
  if (factoryVerification === 'PONS') return 'PONS';
  if (factoryVerification === 'UNAVAILABLE') return 'UNKNOWN';

  // CUSTOM is safe only when the durable lookup was available and every known
  // PONS factory produced a definitive non-match. Provider uncertainty stays UNKNOWN.
  return databaseAvailable ? 'CUSTOM' : 'UNKNOWN';
}

export async function evaluateRobinhoodPositiveAlertSecurity(args: {
  tokenAddress: string;
  raw?: Record<string, unknown> | null;
}): Promise<PositiveAlertSecurityDecision> {
  const launchType = await classifyRobinhoodLaunch(args.tokenAddress);
  return evaluatePositiveAlertSecurity({ launchType, raw: args.raw });
}
