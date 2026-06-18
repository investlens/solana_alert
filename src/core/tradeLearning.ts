import { supabase } from '../services/supabase.js';

export async function getTradeLearningSummary() {
  const { data, error } = await supabase
    .from('trade_history')
    .select('pnl_percent, entry_score, socials, holder_risk, bundle_risk')
    .eq('status', 'CLOSED')
    .not('pnl_percent', 'is', null)
    .order('sold_at', { ascending: false })
    .limit(100);

  if (error || !data?.length) {
    return {
      total: 0,
      avgPnl: 0,
      winRate: 0,
      bestSocials: null,
    };
  }

  const wins = data.filter((t) => Number(t.pnl_percent) > 0);
  const avgPnl =
    data.reduce((sum, t) => sum + Number(t.pnl_percent ?? 0), 0) / data.length;

  const bySocials = new Map<string, { count: number; pnl: number }>();

  for (const trade of data) {
    const key = trade.socials || 'unknown';
    const current = bySocials.get(key) ?? { count: 0, pnl: 0 };
    current.count += 1;
    current.pnl += Number(trade.pnl_percent ?? 0);
    bySocials.set(key, current);
  }

  const bestSocials =
    [...bySocials.entries()]
      .map(([socials, v]) => ({
        socials,
        count: v.count,
        avgPnl: v.pnl / v.count,
      }))
      .sort((a, b) => b.avgPnl - a.avgPnl)[0] ?? null;

  return {
    total: data.length,
    avgPnl,
    winRate: (wins.length / data.length) * 100,
    bestSocials,
  };
}