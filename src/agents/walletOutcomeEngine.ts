import { supabase } from '../services/supabase.js';

type WalletTrade = {
  id: number;
  wallet: string;
  token: string;
  market_cap_at_action: number | null;
};

type TokenMemory = {
  token: string;
  alert_market_cap: number | null;
  first_market_cap: number | null;

  return_5m_pct: number | null;
  return_15m_pct: number | null;
  return_30m_pct: number | null;
  return_1h_pct: number | null;
  return_6h_pct: number | null;
  return_24h_pct: number | null;

  peak_market_cap: number | null;
  max_return_pct: number | null;
  outcome: string | null;
  final_outcome: string | null;
  tracking_complete: boolean | null;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function calculateReturn(
  entryMarketCap: number | null,
  targetMarketCap: number | null
): number | null {
  if (
    entryMarketCap == null ||
    targetMarketCap == null ||
    entryMarketCap <= 0
  ) {
    return null;
  }

  return ((targetMarketCap - entryMarketCap) / entryMarketCap) * 100;
}

function normalizeOutcome(memory: TokenMemory) {
  return (
    memory.final_outcome ??
    memory.outcome ??
    'TRACKING'
  ).toUpperCase();
}

async function fetchPendingTrades(): Promise<WalletTrade[]> {
  const { data, error } = await supabase
    .from('wallet_trade_history')
    .select('id, wallet, token, market_cap_at_action')
    .eq('action', 'BUY')
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    console.log('wallet outcome fetch error:', error.message);
    return [];
  }

  return (data ?? []) as WalletTrade[];
}

async function fetchTokenMemory(token: string): Promise<TokenMemory | null> {
  const { data, error } = await supabase
    .from('token_memory')
    .select(`
      token,
      alert_market_cap,
      first_market_cap,
      return_5m_pct,
      return_15m_pct,
      return_30m_pct,
      return_1h_pct,
      return_6h_pct,
      return_24h_pct,
      peak_market_cap,
      max_return_pct,
      outcome,
      final_outcome,
      tracking_complete
    `)
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.log('wallet token-memory lookup error:', {
      token,
      error: error.message,
    });

    return null;
  }

  return data as TokenMemory | null;
}

export async function syncWalletTradeOutcomes() {
  const trades = await fetchPendingTrades();

  if (!trades.length) {
    console.log('wallet outcome engine: no buy trades');
    return;
  }

  const affectedWallets = new Set<string>();

  for (const trade of trades) {
    const memory = await fetchTokenMemory(trade.token);

    if (!memory) continue;

    const storedEntry = finiteNumber(trade.market_cap_at_action);

    const fallbackEntry =
      finiteNumber(memory.alert_market_cap) ??
      finiteNumber(memory.first_market_cap);

    const entryMarketCap = storedEntry ?? fallbackEntry;

    const peakMarketCap = finiteNumber(memory.peak_market_cap);

    const maxReturnPct =
      entryMarketCap != null && peakMarketCap != null
        ? calculateReturn(entryMarketCap, peakMarketCap)
        : finiteNumber(memory.max_return_pct);

    const updatePayload = {
      market_cap_at_action: entryMarketCap,

      return_5m_pct: finiteNumber(memory.return_5m_pct),
      return_15m_pct: finiteNumber(memory.return_15m_pct),
      return_30m_pct: finiteNumber(memory.return_30m_pct),
      return_1h_pct: finiteNumber(memory.return_1h_pct),
      return_6h_pct: finiteNumber(memory.return_6h_pct),
      return_24h_pct: finiteNumber(memory.return_24h_pct),

      token_peak_market_cap: peakMarketCap,
      max_return_pct: maxReturnPct,
      roi_percent: maxReturnPct,

      outcome: normalizeOutcome(memory),
      final_outcome: memory.final_outcome,
      outcome_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('wallet_trade_history')
      .update(updatePayload)
      .eq('id', trade.id);

    if (error) {
      console.log('wallet outcome update error:', {
        tradeId: trade.id,
        token: trade.token,
        error: error.message,
      });

      continue;
    }

    affectedWallets.add(trade.wallet);
  }

  for (const wallet of affectedWallets) {
    await recalculateWalletReputation(wallet);
  }

  console.log('wallet outcomes synchronized:', {
    tradesChecked: trades.length,
    walletsUpdated: affectedWallets.size,
  });
}

function isWinningOutcome(outcome: string) {
  return [
    'POSITIVE',
    'WINNER',
    'STRONG_WINNER',
    'MOONSHOT',
  ].includes(outcome.toUpperCase());
}

function isFailedOutcome(outcome: string) {
  return [
    'FAILED',
    'RUG',
    'DEAD',
    'SPIKE_AND_DUMP',
  ].includes(outcome.toUpperCase());
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

export async function recalculateAllWalletReputations() {
  const { data, error } = await supabase
    .from('wallet_trade_history')
    .select('wallet')
    .eq('action', 'BUY');

  if (error) {
    console.log(
      'wallet reputation wallet-list error:',
      error.message
    );
    return;
  }

  const wallets = [
    ...new Set(
      (data ?? [])
        .map((row) => String(row.wallet ?? ''))
        .filter(Boolean)
    ),
  ];

  for (const wallet of wallets) {
    await recalculateWalletReputation(wallet);
  }

  console.log('all wallet reputations recalculated:', {
    wallets: wallets.length,
  });
}

export async function recalculateWalletReputation(wallet: string) {
  const { data, error } = await supabase
    .from('wallet_trade_history')
    .select(`
      token,
      outcome,
      final_outcome,
      return_5m_pct,
      return_1h_pct,
      max_return_pct
    `)
    .eq('wallet', wallet)
    .eq('action', 'BUY');

  if (error) {
    console.log('wallet reputation fetch error:', {
      wallet,
      error: error.message,
    });

    return;
  }

  const trades = data ?? [];

  const completed = trades.filter((trade) => {
    const outcome = String(
      trade.final_outcome ?? trade.outcome ?? ''
    ).toUpperCase();

    return outcome && outcome !== 'TRACKING';
  });

  const positiveTrades = completed.filter((trade) =>
    isWinningOutcome(
      String(trade.final_outcome ?? trade.outcome ?? '')
    )
  ).length;

  const failedTrades = completed.filter((trade) =>
    isFailedOutcome(
      String(trade.final_outcome ?? trade.outcome ?? '')
    )
  ).length;

  const returns5m = completed
    .map((trade) => finiteNumber(trade.return_5m_pct))
    .filter((value): value is number => value != null);

  const returns1h = completed
    .map((trade) => finiteNumber(trade.return_1h_pct))
    .filter((value): value is number => value != null);

  const maxReturns = completed
    .map((trade) => finiteNumber(trade.max_return_pct))
    .filter((value): value is number => value != null);

  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) /
        values.length
      : 0;

  const winRate =
    completed.length > 0
      ? (positiveTrades / completed.length) * 100
      : 0;

  const avg5mReturn = average(returns5m);
  const avg1hReturn = average(returns1h);
  const avgMaxReturn = average(maxReturns);
  const bestReturn = maxReturns.length
    ? Math.max(...maxReturns)
    : 0;

  let trustScore = 35;

  if (completed.length >= 3) trustScore += 5;
  if (completed.length >= 10) trustScore += 5;
  if (completed.length >= 25) trustScore += 5;

  if (winRate >= 70) trustScore += 25;
  else if (winRate >= 55) trustScore += 18;
  else if (winRate >= 40) trustScore += 8;
  else if (completed.length >= 5 && winRate < 20) trustScore -= 20;

  if (avg5mReturn >= 20) trustScore += 10;
  else if (avg5mReturn <= -20) trustScore -= 10;

  if (avg1hReturn >= 40) trustScore += 10;
  else if (avg1hReturn <= -30) trustScore -= 10;

  if (avgMaxReturn >= 100) trustScore += 10;
  else if (avgMaxReturn >= 50) trustScore += 5;

  if (bestReturn >= 300) trustScore += 8;
  else if (bestReturn >= 100) trustScore += 4;

  trustScore = Math.round(clamp(trustScore));

  const label =
    completed.length < 3
      ? 'UNKNOWN'
      : trustScore >= 85
        ? 'ELITE'
        : trustScore >= 70
          ? 'SMART'
          : trustScore >= 55
            ? 'PROMISING'
            : trustScore >= 40
              ? 'NEUTRAL'
              : 'RISKY';

  const summary =
    completed.length === 0
      ? 'No completed token outcomes yet.'
      : `${positiveTrades}/${completed.length} tracked entries were positive; average peak return ${avgMaxReturn.toFixed(1)}%.`;

  const { error: updateError } = await supabase
    .from('wallet_intelligence')
    .upsert(
      {
        wallet,

        total_buys: trades.length,
        tokens_seen: trades.length,

        completed_trades: completed.length,
        positive_trades: positiveTrades,
        failed_trades: failedTrades,

        wins: positiveTrades,
        losses: failedTrades,

        win_rate: winRate,
        avg_5m_return: avg5mReturn,
        avg_1h_return: avg1hReturn,
        avg_max_return: avgMaxReturn,

        avg_roi: avgMaxReturn,
        best_roi: bestReturn,

        trust_score: trustScore,
        label,
        reputation_summary: summary,

        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'wallet',
      }
    );

  if (updateError) {
    console.log('wallet reputation update error:', {
      wallet,
      error: updateError.message,
    });

    return;
  }

  console.log('wallet reputation recalculated:', {
    wallet,
    label,
    trustScore,
    completedTrades: completed.length,
    winRate: Number(winRate.toFixed(1)),
    avgMaxReturn: Number(avgMaxReturn.toFixed(1)),
  });
}