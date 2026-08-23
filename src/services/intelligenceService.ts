import { supabase } from './supabase.js';
import { getLatestOpportunities } from '../core/opportunityRegistry.js';
import {
  assessPerformance,
  PERFORMANCE_PRICE_SOURCE_VERSION,
} from '../product/intelligenceCredibility.js';

export async function getRecentInvestigations(limit = 8) {
  const rows = await getLatestOpportunities(Math.max(limit * 3, 20));
  return rows
    .filter((row: any) => !['EXECUTED', 'REJECTED', 'EXPIRED', 'REVIEWED']
      .includes(String(row.status ?? '').toUpperCase()))
    .slice(0, limit);
}

export async function getSmartMoneyLeaders(limit = 8) {
  const { data, error } = await supabase
    .from('wallet_intelligence')
    .select('wallet,label,trust_score,total_buys,completed_trades,win_rate,avg_max_return,updated_at')
    .order('trust_score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getCreatorLeaders(limit = 8) {
  const { data, error } = await supabase
    .from('creator_intelligence')
    .select('creator_wallet,chain,total_launches,successful_launches,failed_launches,best_market_cap,trust_score,last_token,last_seen_at')
    .order('trust_score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getPerformanceLeaders(limit = 8) {
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
}
