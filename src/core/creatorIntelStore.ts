import { supabase } from '../services/supabase.js';


async function recordCreatorEvent(args: {
  creatorWallet: string;
  eventType: string;
  token?: string;
  symbol?: string | null;
  marketCap?: number;
  source?: string;
}) {
  const { error } = await supabase
    .from('creator_wallet_events')
    .insert({
      creator_wallet: args.creatorWallet,
      event_type: args.eventType,
      token: args.token ?? null,
      symbol: args.symbol ?? null,
      market_cap: args.marketCap ?? null,
      source: args.source ?? 'CreatorMarketTracker',
      raw_data: {},
    });

  if (error) {
    console.log('creator wallet event error:', {
      creatorWallet: args.creatorWallet,
      eventType: args.eventType,
      error: error.message,
    });
  }
}

export async function saveCreatorLaunch(args: {
  creatorWallet?: string | null;
  token: string;
  symbol?: string | null;
  name?: string | null;
  initialMarketCap?: number | null;
}) {
  if (!args.token) return;

  const now = new Date().toISOString();

  const { error } = await supabase.from('creator_launches').upsert(
    {
      creator_wallet: args.creatorWallet ?? null,
      token: args.token,
      symbol: args.symbol ?? null,
      name: args.name ?? null,
      initial_market_cap: args.initialMarketCap ?? null,
      current_market_cap: args.initialMarketCap ?? null,
      launched_at: now,
      last_checked_at: now,
    },
    {
      onConflict: 'token',
    }
  );

  if (error) {
    console.log('creator launch save error:', {
      token: args.token,
      error: error.message,
    });

    throw error;
  }
}

export async function getProvenCreator(
  creatorWallet?: string | null
) {
  if (!creatorWallet) return null;

  const { data, error } = await supabase
    .from('proven_creators')
    .select('*')
    .eq('creator_wallet', creatorWallet)
    .maybeSingle();

  if (error) {
    console.log('proven creator lookup error:', {
      creatorWallet,
      error: error.message,
    });

    throw error;
  }

  return data;
}

export async function markProvenCreator(args: {
  creatorWallet: string;
  bestToken: string;
  bestSymbol?: string | null;
  bestMarketCap: number;
}) {
  if (!args.creatorWallet || !args.bestToken) return;

  const incomingMarketCap = Number(args.bestMarketCap ?? 0);

  if (
    !Number.isFinite(incomingMarketCap) ||
    incomingMarketCap < 500_000
  ) {
    return;
  }

  const existing = await getProvenCreator(args.creatorWallet);

  const existingBestMarketCap = Number(
    existing?.best_market_cap ?? 0
  );

  /*
   * Critical protection:
   *
   * Never allow a smaller market-cap value to replace the creator's
   * verified historical best launch.
   */
  if (
    existing &&
    incomingMarketCap <= existingBestMarketCap
  ) {
    console.log('creator best market cap preserved:', {
      creatorWallet: args.creatorWallet,
      existingBestMarketCap,
      incomingMarketCap,
    });

    return;
  }

  const existingTrustScore = Number(
    existing?.trust_score ?? 0
  );

  const status =
    incomingMarketCap >= 1_000_000
      ? 'PROVEN'
      : existing?.status === 'PROVEN'
        ? 'PROVEN'
        : 'PROMISING';

  const trustScore =
    incomingMarketCap >= 1_000_000
      ? Math.max(existingTrustScore, 75)
      : Math.max(existingTrustScore, 65);

  const reputationSummary =
    incomingMarketCap >= 1_000_000
      ? `Elite creator launch: ${
          args.bestSymbol ?? 'token'
        } reached $${Math.round(
          incomingMarketCap
        ).toLocaleString('en-US')}.`
      : `Reputed creator launch: ${
          args.bestSymbol ?? 'token'
        } reached $${Math.round(
          incomingMarketCap
        ).toLocaleString('en-US')}.`;

  const { error } = await supabase
    .from('proven_creators')
    .upsert(
      {
        creator_wallet: args.creatorWallet,

        best_token: args.bestToken,
        best_symbol: args.bestSymbol ?? null,
        best_market_cap: incomingMarketCap,

        status,
        trust_score: trustScore,
        reputation_summary: reputationSummary,

        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'creator_wallet',
      }
    );

  if (error) {
    console.log('creator reputation promotion error:', {
      creatorWallet: args.creatorWallet,
      bestSymbol: args.bestSymbol ?? null,
      bestMarketCap: incomingMarketCap,
      error: error.message,
    });

    throw error;
  }

  console.log('creator market-cap reputation updated:', {
    creatorWallet: args.creatorWallet,
    bestToken: args.bestToken,
    bestSymbol: args.bestSymbol ?? null,
    bestMarketCap: incomingMarketCap,
    status,
    trustScore,
  });

  await recordCreatorEvent({
  creatorWallet: args.creatorWallet,
  eventType:
    incomingMarketCap >= 1_000_000
      ? 'ELITE'
      : 'PROMOTED',
  token: args.bestToken,
  symbol: args.bestSymbol,
  marketCap: incomingMarketCap,
});
}