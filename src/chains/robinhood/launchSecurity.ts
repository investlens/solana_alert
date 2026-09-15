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
      // Back off after a failed refresh so a Supabase outage cannot force every
      // candidate back through the same census query. Authoritative live PONS
      // tokens already remembered in memory remain usable.
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

async function verifyPonsOnChainDuringDatabaseOutage(tokenAddress: string): Promise<boolean> {
  try {
    const { getPonsLaunchState } = await import('./ponsLaunchState.js');
    const state = await getPonsLaunchState(tokenAddress, { skipIndexedLookup: true });
    if (!state.exists || normalize(state.token) !== normalize(tokenAddress)) return false;
    rememberAuthoritativePonsToken(tokenAddress);
    console.log('[RobinhoodLaunchSecurity] PONS identity verified directly by current factory during census outage.', {
      token: normalize(tokenAddress),
      deployer: state.deployer,
      launchConfigId: state.launchConfigId.toString(),
    });
    return true;
  } catch (error) {
    console.warn('[RobinhoodLaunchSecurity] Direct factory PONS fallback could not verify token.', {
      token: normalize(tokenAddress),
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function classifyRobinhoodLaunch(tokenAddress: string): Promise<LaunchClassification> {
  const token = normalize(tokenAddress);

  if (recentPonsTokens.has(token)) return 'PONS';
  if (Date.now() - recentPonsCacheAt >= RECENT_PONS_CACHE_MS) {
    await refreshRecentPonsCache();
  }
  if (recentPonsTokens.has(token)) return 'PONS';

  try {
    // EVM addresses are exact identifiers. Avoid ILIKE here: it prevents the
    // existing btree index from serving this very hot lookup efficiently.
    // Live PONS detections are normalized and remembered above, while the DB
    // lookup remains a durable fallback for normalized historical rows.
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
    return 'CUSTOM';
  } catch (error) {
    if (recentPonsTokens.has(token)) return 'PONS';
    if (await verifyPonsOnChainDuringDatabaseOutage(tokenAddress)) return 'PONS';
    console.warn('[RobinhoodLaunchSecurity] PONS census unavailable and current factory did not verify token; remaining fail-closed CUSTOM.', {
      token,
      cachedPonsTokens: recentPonsTokens.size,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 'CUSTOM';
  }
}

export async function evaluateRobinhoodPositiveAlertSecurity(args: {
  tokenAddress: string;
  raw?: Record<string, unknown> | null;
}): Promise<PositiveAlertSecurityDecision> {
  const launchType = await classifyRobinhoodLaunch(args.tokenAddress);
  return evaluatePositiveAlertSecurity({ launchType, raw: args.raw });
}
