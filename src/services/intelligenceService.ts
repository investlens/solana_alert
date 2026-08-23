import { supabase } from './supabase.js';
import { getLatestOpportunities } from '../core/opportunityRegistry.js';

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
  const { data, error } = await supabase
    .from('alpha_signals')
    .select('symbol,token,title,roi_high,roi_now,alert_price,current_price,updated_at')
    .not('roi_high', 'is', null)
    .order('roi_high', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
