import { supabase } from '../services/supabase.js';

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function recordWalletTrade(args: {
  wallet: string;
  token: string;
  action: 'BUY' | 'SELL';
  amountSol?: number | null;
  marketCapAtAction?: number | null;
}) {
  if (!args.wallet || !args.token) return;

  const { error } = await supabase.from('wallet_trade_history').upsert(
    {
      wallet: args.wallet,
      token: args.token,
      action: args.action,
      amount_sol: args.amountSol ?? null,
      market_cap_at_action: args.marketCapAtAction ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'wallet,token,action' }
  );

  if (error) {
    console.log('recordWalletTrade error:', error);
    return;
  }

  console.log('wallet trade history recorded:', {
    wallet: args.wallet,
    token: args.token,
    action: args.action,
    marketCapAtAction: args.marketCapAtAction ?? null,
  });
}

export async function updateWalletOutcomeForToken(args: {
  token: string;
  peakMarketCap: number;
}) {
  const { data, error } = await supabase
    .from('wallet_trade_history')
    .select('*')
    .eq('token', args.token)
    .eq('action', 'BUY');

  if (error) {
    console.log('updateWalletOutcomeForToken fetch error:', error);
    return;
  }

  for (const trade of data ?? []) {
    const entryMc = num(trade.market_cap_at_action);
    const peakMc = num(args.peakMarketCap);

    let roiPercent: number | null = null;
    if (entryMc > 0 && peakMc > 0) {
      roiPercent = ((peakMc - entryMc) / entryMc) * 100;
    }

    const outcome =
      peakMc >= 1_000_000
        ? 'HIT_1M'
        : peakMc >= 500_000
          ? 'HIT_500K'
          : peakMc >= 100_000
            ? 'HIT_100K'
            : 'TRACKING';

    const { error: updateError } = await supabase
      .from('wallet_trade_history')
      .update({
        token_peak_market_cap: peakMc || null,
        roi_percent: roiPercent,
        outcome,
        updated_at: new Date().toISOString(),
      })
      .eq('id', trade.id);

    if (updateError) {
      console.log('updateWalletOutcomeForToken update error:', updateError);
    }
  }
}

export async function refreshSmartWalletScore(wallet: string) {
  const { data, error } = await supabase
    .from('wallet_trade_history')
    .select('*')
    .eq('wallet', wallet)
    .eq('action', 'BUY');

  if (error) {
    console.log('refreshSmartWalletScore error:', error);
    return null;
  }

  const trades = data ?? [];

  const totalBuys = trades.length;
  const hit100k = trades.filter((x) => x.outcome === 'HIT_100K').length;
  const hit500k = trades.filter((x) => x.outcome === 'HIT_500K').length;
  const hit1m = trades.filter((x) => x.outcome === 'HIT_1M').length;

  const avgRoi =
    trades.length > 0
      ? trades.reduce((sum, x) => sum + num(x.roi_percent), 0) / trades.length
      : 0;

  const trustScore = clamp(
    30 +
      hit100k * 5 +
      hit500k * 12 +
      hit1m * 25 +
      Math.min(20, avgRoi / 20) -
      Math.max(0, totalBuys - hit100k - hit500k - hit1m) * 2
  );

  const label =
    trustScore >= 85
      ? 'ELITE'
      : trustScore >= 70
        ? 'SMART'
        : trustScore >= 50
          ? 'WATCH'
          : 'NOISE';

  const { error: upsertError } = await supabase.from('wallet_intelligence').upsert({
    wallet,
    total_buys: totalBuys,
    tokens_seen: totalBuys,
    wins: hit100k + hit500k + hit1m,
    losses: Math.max(0, totalBuys - hit100k - hit500k - hit1m),
    avg_roi: avgRoi,
    best_roi: Math.max(0, ...trades.map((x) => num(x.roi_percent))),
    trust_score: Math.round(trustScore),
    label,
    updated_at: new Date().toISOString(),
  });

  if (upsertError) {
    console.log('refreshSmartWalletScore upsert error:', upsertError);
  }

  console.log('smart wallet score refreshed:', {
    wallet,
    totalBuys,
    hit100k,
    hit500k,
    hit1m,
    trustScore: Math.round(trustScore),
    label,
  });

  return {
    wallet,
    totalBuys,
    hit100k,
    hit500k,
    hit1m,
    trustScore: Math.round(trustScore),
    label,
  };
}

export async function getSmartWalletScore(wallet: string) {
  const { data, error } = await supabase
    .from('wallet_intelligence')
    .select('*')
    .eq('wallet', wallet)
    .maybeSingle();

  if (error || !data) {
    return {
      wallet,
      trustScore: 30,
      label: 'UNKNOWN',
    };
  }

  return {
    wallet,
    trustScore: num(data.trust_score),
    label: data.label ?? 'UNKNOWN',
  };
}