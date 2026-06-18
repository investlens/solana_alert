import { supabase } from '../services/supabase.js';

export async function saveCreatorLaunch(args: {
  creatorWallet?: string | null;
  token: string;
  symbol?: string | null;
  name?: string | null;
  initialMarketCap?: number | null;
}) {
  if (!args.token) return;

  const { error } = await supabase.from('creator_launches').upsert(
    {
      creator_wallet: args.creatorWallet ?? null,
      token: args.token,
      symbol: args.symbol ?? null,
      name: args.name ?? null,
      initial_market_cap: args.initialMarketCap ?? null,
      current_market_cap: args.initialMarketCap ?? null,
      launched_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: 'token' }
  );

  if (error) throw error;
}

export async function getProvenCreator(creatorWallet?: string | null) {
  if (!creatorWallet) return null;

  const { data, error } = await supabase
    .from('proven_creators')
    .select('*')
    .eq('creator_wallet', creatorWallet)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function markProvenCreator(args: {
  creatorWallet: string;
  bestToken: string;
  bestSymbol?: string | null;
  bestMarketCap: number;
}) {
  const { error } = await supabase.from('proven_creators').upsert(
    {
      creator_wallet: args.creatorWallet,
      best_token: args.bestToken,
      best_symbol: args.bestSymbol ?? null,
      best_market_cap: args.bestMarketCap,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'creator_wallet' }
  );

  if (error) throw error;
}