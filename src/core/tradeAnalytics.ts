import { supabase } from '../services/supabase.js';

export async function recordTradeOpen(args: {
  token: string;
  symbol: string;
  entryPrice: number;
  highestPrice: number;
  liquidity?: number | null;
  volume5m?: number | null;
  socials?: string | null;
  entryScore?: number | null;
  creatorScore?: number | null;
  holderRisk?: number | null;
  bundleRisk?: number | null;
}) {
  const { error } = await supabase.from('trade_history').insert({
    token: args.token,
    symbol: args.symbol,
    entry_price: args.entryPrice,
    highest_price: args.highestPrice,
    liquidity: args.liquidity ?? null,
    volume_5m: args.volume5m ?? null,
    socials: args.socials ?? null,
    entry_score: args.entryScore ?? null,
    creator_score: args.creatorScore ?? null,
    holder_risk: args.holderRisk ?? null,
    bundle_risk: args.bundleRisk ?? null,
    status: 'OPEN',
  });

  if (error) {
    console.log('recordTradeOpen error:', error);
  }
}

export async function recordTradeClose(args: {
  token: string;
  exitPrice: number;
  highestPrice: number;
  pnlPercent: number;
}) {
  const { error } = await supabase
    .from('trade_history')
    .update({
      exit_price: args.exitPrice,
      highest_price: args.highestPrice,
      pnl_percent: args.pnlPercent,
      sold_at: new Date().toISOString(),
      status: 'CLOSED',
    })
    .eq('token', args.token)
    .eq('status', 'OPEN');

  if (error) {
    console.log('recordTradeClose error:', error);
  }
}