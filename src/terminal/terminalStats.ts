import { supabase } from '../services/supabase.js';

export type TerminalStats = {
  version: string;
  chain: string;
  scannerStatus: 'RUNNING' | 'DEGRADED' | 'STOPPED';

  tokensTracked: number;
  timelineEvents: number;
  alertsToday: number;
  buysToday: number;

  latestBuy: {
    token: string;
    symbol: string;
    marketCap: number | null;
    score: number | null;
    createdAt: string | null;
  } | null;

  apiStatus: {
    dexScreener: 'OK' | 'UNKNOWN';
    helius: 'OK' | 'RATE_LIMITED' | 'UNKNOWN';
    bitquery: 'OK' | 'QUOTA_EXCEEDED' | 'UNKNOWN';
    pumpfun: 'OK' | 'UNKNOWN';
  };
};

async function countRows(table: string) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.log('terminal count error:', {
      table,
      error: error.message,
    });
    return 0;
  }

  return count ?? 0;
}

export async function getTerminalStats(): Promise<TerminalStats> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [
    tokensTracked,
    timelineEvents,
    alertsTodayResult,
    buysTodayResult,
    latestBuyResult,
  ] = await Promise.all([
    countRows('token_memory'),
    countRows('token_memory_events'),

    supabase
      .from('token_memory_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'ALERT_CREATED')
      .gte('created_at', startOfDay.toISOString()),

    supabase
      .from('token_memory_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'ALERT_CREATED')
      .ilike('note', '%BUY%')
      .gte('created_at', startOfDay.toISOString()),

    supabase
      .from('token_memory_events')
      .select('token, market_cap, alpha_score, note, created_at')
      .eq('event_type', 'ALERT_CREATED')
      .ilike('note', '%BUY%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const latestBuyData = latestBuyResult.data;

  const latestBuy = latestBuyData
    ? {
        token: latestBuyData.token,
        symbol:
          String(latestBuyData.note ?? '')
            .split(' alert created')[0]
            .trim() || 'UNKNOWN',
        marketCap:
          latestBuyData.market_cap != null
            ? Number(latestBuyData.market_cap)
            : null,
        score:
          latestBuyData.alpha_score != null
            ? Number(latestBuyData.alpha_score)
            : null,
        createdAt: latestBuyData.created_at ?? null,
      }
    : null;

  return {
    version: 'v0.6',
    chain: 'SOLANA',
    scannerStatus: 'RUNNING',

    tokensTracked,
    timelineEvents,
    alertsToday: alertsTodayResult.count ?? 0,
    buysToday: buysTodayResult.count ?? 0,

    latestBuy,

    apiStatus: {
      dexScreener: 'OK',
      helius: 'RATE_LIMITED',
      bitquery: 'QUOTA_EXCEEDED',
      pumpfun: 'UNKNOWN',
    },
  };
}