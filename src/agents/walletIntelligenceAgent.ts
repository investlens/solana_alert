import { supabase } from '../services/supabase.js';

export async function recordWalletBuy(args: {
  wallet: string;
  token: string;
  amountSol?: number | null;
}) {
  const { data: existing } = await supabase
    .from('wallet_intelligence')
    .select('*')
    .eq('wallet', args.wallet)
    .maybeSingle();

  const totalBuys = Number(existing?.total_buys ?? 0) + 1;
  const tokensSeen = Number(existing?.tokens_seen ?? 0) + 1;

  const trustScore = Math.min(100, 50 + Math.floor(totalBuys / 5));

  const { error } = await supabase.from('wallet_intelligence').upsert({
    wallet: args.wallet,
    total_buys: totalBuys,
    total_sells: Number(existing?.total_sells ?? 0),
    tokens_seen: tokensSeen,
    wins: Number(existing?.wins ?? 0),
    losses: Number(existing?.losses ?? 0),
    avg_roi: Number(existing?.avg_roi ?? 0),
    best_roi: Number(existing?.best_roi ?? 0),
    trust_score: trustScore,
    last_token: args.token,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.log('recordWalletBuy error:', error);
  }
}

export async function recordWalletSell(args: {
  wallet: string;
  token?: string | null;
}) {
  const { data: existing } = await supabase
    .from('wallet_intelligence')
    .select('*')
    .eq('wallet', args.wallet)
    .maybeSingle();

  const { error } = await supabase.from('wallet_intelligence').upsert({
    wallet: args.wallet,
    total_buys: Number(existing?.total_buys ?? 0),
    total_sells: Number(existing?.total_sells ?? 0) + 1,
    tokens_seen: Number(existing?.tokens_seen ?? 0),
    wins: Number(existing?.wins ?? 0),
    losses: Number(existing?.losses ?? 0),
    avg_roi: Number(existing?.avg_roi ?? 0),
    best_roi: Number(existing?.best_roi ?? 0),
    trust_score: Number(existing?.trust_score ?? 50),
    last_token: args.token ?? existing?.last_token ?? null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.log('recordWalletSell error:', error);
  }
}

export async function getWalletTrust(wallet: string) {
  const { data, error } = await supabase
    .from('wallet_intelligence')
    .select('*')
    .eq('wallet', wallet)
    .maybeSingle();

  if (error || !data) {
    return {
      wallet,
      trustScore: 50,
      label: 'UNKNOWN',
      totalBuys: 0,
      totalSells: 0,
    };
  }

  const trustScore = Number(data.trust_score ?? 50);

  const label =
    trustScore >= 80 ? 'SMART' :
    trustScore >= 65 ? 'PROMISING' :
    trustScore >= 45 ? 'UNKNOWN' :
    'WEAK';

  return {
    wallet,
    trustScore,
    label,
    totalBuys: Number(data.total_buys ?? 0),
    totalSells: Number(data.total_sells ?? 0),
  };
}