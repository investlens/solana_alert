import { supabase } from './supabase.js';
import { getLatestOpportunities } from '../core/opportunityRegistry.js';
import {
  assessPerformance,
  PERFORMANCE_PRICE_SOURCE_VERSION,
} from '../product/intelligenceCredibility.js';

type CacheEntry = { value: any; updatedAt: number };
const intelligenceCache = new Map<string, CacheEntry>();
const refreshes = new Map<string, Promise<void>>();
const FRESH_MS = 5 * 60_000;
const EMPTY: any[] = [];

function cached<T>(key: string): T | undefined {
  return intelligenceCache.get(key)?.value as T | undefined;
}

function refreshInBackground<T>(key: string, loader: () => Promise<T>) {
  if (refreshes.has(key)) return;
  const task = loader()
    .then((value) => {
      intelligenceCache.set(key, { value, updatedAt: Date.now() });
    })
    .catch((error) => {
      console.warn('[IntelligenceCache] refresh failed; serving last-good snapshot.', {
        key,
        reason: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => refreshes.delete(key));
  refreshes.set(key, task);
}

async function snapshotFirst<T>(key: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  const entry = intelligenceCache.get(key);
  if (entry) {
    if (Date.now() - entry.updatedAt > FRESH_MS) refreshInBackground(key, loader);
    return entry.value as T;
  }

  // Cold start gets only a very small DB budget. Telegram must stay responsive.
  try {
    const value = await Promise.race([
      loader(),
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('intelligence cold-start budget exceeded')), 700)),
    ]);
    intelligenceCache.set(key, { value, updatedAt: Date.now() });
    return value;
  } catch (error) {
    console.warn('[IntelligenceCache] cold read unavailable; returning fast fallback.', {
      key,
      reason: error instanceof Error ? error.message : String(error),
    });
    refreshInBackground(key, loader);
    return fallback;
  }
}

export async function getRecentInvestigations(limit = 8) {
  return snapshotFirst(`investigations:${limit}`, async () => {
    const rows = await getLatestOpportunities(Math.max(limit * 3, 20));
    return rows
      .filter((row: any) => !['EXECUTED', 'REJECTED', 'EXPIRED', 'REVIEWED']
        .includes(String(row.status ?? '').toUpperCase()))
      .slice(0, limit);
  }, EMPTY);
}

export async function getSmartMoneyLeaders(limit = 8) {
  return snapshotFirst(`smart-money:${limit}`, async () => {
    const { data, error } = await supabase
      .from('wallet_intelligence')
      .select('wallet,label,trust_score,total_buys,completed_trades,win_rate,avg_max_return,updated_at')
      .order('trust_score', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }, EMPTY);
}

export async function getCreatorLeaders(limit = 8) {
  return snapshotFirst(`creators:${limit}`, async () => {
    const { data, error } = await supabase
      .from('creator_intelligence')
      .select('creator_wallet,chain,total_launches,successful_launches,failed_launches,best_market_cap,trust_score,last_token,last_seen_at')
      .order('trust_score', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }, EMPTY);
}

export async function getPonsDeveloperLeaders(limit = 8) {
  return snapshotFirst(`pons-developers:${limit}`, async () => {
    const { data, error } = await supabase
      .from('pons_developer_registry')
      .select('deployer_address,total_launches,winners_100k,winners_500k,winners_1m,best_verified_peak_market_cap,confidence,tier,risk_tier,latest_launch_at')
      .gt('winners_100k', 0)
      .order('winners_1m', { ascending: false })
      .order('winners_500k', { ascending: false })
      .order('winners_100k', { ascending: false })
      .order('best_verified_peak_market_cap', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }, EMPTY);
}

export async function getPerformanceLeaders(limit = 8) {
  const fallback = { leaders: [], reviewCount: 0, unavailableCount: 0 };
  return snapshotFirst(`performance:${limit}`, async () => {
    const [verifiedResult, legacyResult] = await Promise.all([
      supabase
        .from('alpha_signals')
        .select('symbol,token,title,alert_price,current_price,high_after_alert,price_source_version,updated_at')
        .eq('price_source_version', PERFORMANCE_PRICE_SOURCE_VERSION)
        .not('alert_price', 'is', null)
        .order('roi_high', { ascending: false })
        .limit(Math.max(limit * 3, 24)),
      supabase
        .from('alpha_signals')
        .select('signal_key', { count: 'exact', head: true })
        .not('alert_price', 'is', null)
        .or(`price_source_version.is.null,price_source_version.neq.${PERFORMANCE_PRICE_SOURCE_VERSION}`),
    ]);
    if (verifiedResult.error) throw verifiedResult.error;
    if (legacyResult.error) throw legacyResult.error;

    const assessed = (verifiedResult.data ?? []).map(row => ({
      ...row,
      performance: assessPerformance({
        referencePrice: row.alert_price,
        peakPrice: row.high_after_alert,
        currentPrice: row.current_price,
        updatedAt: row.updated_at,
        sourceVerified: true,
      }),
    }));

    return {
      leaders: assessed
        .filter(row => row.performance.status === 'AVAILABLE')
        .sort((a, b) => (b.performance.peakRoi ?? -Infinity) - (a.performance.peakRoi ?? -Infinity))
        .slice(0, limit),
      reviewCount: legacyResult.count ?? 0,
      unavailableCount: assessed.filter(row => row.performance.status === 'UNAVAILABLE').length,
    };
  }, fallback);
}
