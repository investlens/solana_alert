import { supabase } from '../services/supabase.js';

export async function startOutcomeTracking(args: {
  token: string;
  symbol?: string | null;
  creatorWallet?: string | null;
  initialMarketCap?: number | null;
}) {
  const { error } = await supabase
    .from('token_outcomes')
    .upsert({
      token: args.token,
      symbol: args.symbol ?? null,
      creator_wallet: args.creatorWallet ?? null,
      initial_market_cap: args.initialMarketCap ?? null,
      status: 'TRACKING',
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.log('startOutcomeTracking error:', error);
    return;
  }

  console.log('outcome tracking started:', {
    token: args.token,
    symbol: args.symbol,
    initialMc: args.initialMarketCap,
  });
}

export async function updateOutcomeSnapshot(args: {
  token: string;
  marketCap: number;
  timeframe: '15m' | '1h' | '6h' | '24h';
}) {
  const { data: existing } = await supabase
    .from('token_outcomes')
    .select('*')
    .eq('token', args.token)
    .maybeSingle();

  if (!existing) {
    console.log('token outcome missing:', args.token);
    return;
  }

  const initialMc = Number(
    existing.initial_market_cap ?? 0
  );

  let roi: number | null = null;

  if (initialMc > 0) {
    roi =
      ((args.marketCap - initialMc) /
        initialMc) *
      100;
  }

  const update: Record<
    string,
    unknown
  > = {
    updated_at:
      new Date().toISOString(),
  };

  if (args.timeframe === '15m') {
    update.market_cap_15m =
      args.marketCap;
    update.roi_15m = roi;
  }

  if (args.timeframe === '1h') {
    update.market_cap_1h =
      args.marketCap;
    update.roi_1h = roi;
  }

  if (args.timeframe === '6h') {
    update.market_cap_6h =
      args.marketCap;
    update.roi_6h = roi;
  }

  if (args.timeframe === '24h') {
    update.market_cap_24h =
      args.marketCap;
    update.roi_24h = roi;
    update.status = 'COMPLETED';
  }

  const { error } = await supabase
    .from('token_outcomes')
    .update(update)
    .eq('token', args.token);

  if (error) {
    console.log(
      'updateOutcomeSnapshot error:',
      error
    );
    return;
  }

  console.log(
    'outcome snapshot updated:',
    {
      token: args.token,
      timeframe: args.timeframe,
      marketCap: args.marketCap,
      roi,
    }
  );
}

export async function getOutcome(
  token: string
) {
  const { data, error } =
    await supabase
      .from('token_outcomes')
      .select('*')
      .eq('token', token)
      .maybeSingle();

  if (error) {
    console.log(
      'getOutcome error:',
      error
    );
    return null;
  }

  return data;
}