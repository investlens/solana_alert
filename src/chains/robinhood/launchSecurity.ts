import { supabase } from '../../services/supabase.js';
import {
  evaluatePositiveAlertSecurity,
  type LaunchClassification,
  type PositiveAlertSecurityDecision,
} from '../../security/positiveAlertSecurity.js';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const RECENT_PONS_CACHE_MS = 60_000;
const RECENT_PONS_CACHE_HOURS = 48;
const RECENT_PONS_CACHE_LIMIT = 10_000;
let recentPonsTokens = new Set<string>();
let recentPonsCacheAt = 0;
let recentPonsRefresh: Promise<void> | null = null;

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
      const next = new Set<string>();
      for (const row of data ?? []) {
        const token = normalize(String(row.token_address ?? ''));
        if (token) next.add(token);
      }
      if (next.size) recentPonsTokens = next;
      recentPonsCacheAt = Date.now();
    } catch (error) {
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

export async function classifyRobinhoodLaunch(tokenAddress: string): Promise<LaunchClassification> {
  const token = normalize(tokenAddress);

  if (Date.now() - recentPonsCacheAt >= RECENT_PONS_CACHE_MS) {
    await refreshRecentPonsCache();
  }
  if (recentPonsTokens.has(token)) return 'PONS';

  try {
    const { data, error } = await supabase
      .from('pons_launches')
      .select('id')
      .eq('chain', 'robinhood')
      .ilike('token_address', token)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      recentPonsTokens.add(token);
      return 'PONS';
    }
    return 'CUSTOM';
  } catch (error) {
    // A database outage must never turn a token that was already authoritatively
    // identified as PONS into CUSTOM. Unknown tokens still fail closed.
    if (recentPonsTokens.has(token)) return 'PONS';
    console.warn('[RobinhoodLaunchSecurity] PONS census lookup failed; unknown token remains fail-closed CUSTOM.', {
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
