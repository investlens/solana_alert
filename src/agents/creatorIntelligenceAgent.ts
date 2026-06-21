import { supabase } from '../services/supabase.js';
import { recordOpportunity } from '../core/opportunityRegistry.js';

export async function recordCreatorLaunch(args: {
  creatorWallet: string | null;
  token: string;
  symbol?: string | null;
  marketCap?: number | null;
  sourceAgent?: string;
  rawData?: Record<string, unknown>;
}) {
  if (!args.creatorWallet) return null;

  const { data: existing } = await supabase
    .from('creator_intelligence')
    .select('*')
    .eq('creator_wallet', args.creatorWallet)
    .maybeSingle();

  const totalLaunches = Number(existing?.total_launches ?? 0) + 1;
  const previousBestMc = Number(existing?.best_market_cap ?? 0);
  const marketCap = Number(args.marketCap ?? 0);

  const bestMarketCap = Math.max(previousBestMc, marketCap);
  const successfulLaunches =
    Number(existing?.successful_launches ?? 0) + (marketCap >= 1_000_000 ? 1 : 0);
  const failedLaunches =
    Number(existing?.failed_launches ?? 0) + (marketCap > 0 && marketCap < 20_000 ? 1 : 0);

  const trustScore = Math.max(
    0,
    Math.min(
      100,
      50 +
        successfulLaunches * 15 -
        failedLaunches * 10 +
        (bestMarketCap >= 1_000_000 ? 20 : 0)
    )
  );

  const { error } = await supabase.from('creator_intelligence').upsert({
    creator_wallet: args.creatorWallet,
    total_launches: totalLaunches,
    successful_launches: successfulLaunches,
    failed_launches: failedLaunches,
    best_market_cap: bestMarketCap,
    avg_market_cap: marketCap,
    trust_score: trustScore,
    last_token: args.token,
    last_seen_at: new Date().toISOString(),
    raw_data: {
      ...(existing?.raw_data ?? {}),
      last: args.rawData ?? {},
    },
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.log('recordCreatorLaunch error:', error);
    return null;
  }

  console.log('creator launch recorded:', {
    creator: args.creatorWallet,
    token: args.token,
    trustScore,
    bestMarketCap,
  });

  if (trustScore >= 70 || bestMarketCap >= 1_000_000) {
    await recordOpportunity({
      opportunityType: 'TOKEN_CREATOR',
      assetId: args.token,
      chain: 'solana',
      sourceAgent: args.sourceAgent ?? 'CreatorIntelligenceAgent',
      title: `Proven creator launch: ${args.symbol ?? args.token}`,
      entryPrice: null,
      exitPrice: null,
      expectedProfit: null,
      expectedProfitPercent: null,
      riskScore: Math.max(10, 100 - trustScore),
      confidence: trustScore,
      status: 'NEW',
      rawData: {
        creatorWallet: args.creatorWallet,
        token: args.token,
        symbol: args.symbol,
        marketCap,
        bestMarketCap,
        trustScore,
        totalLaunches,
        successfulLaunches,
        failedLaunches,
      },
    });
  }

  return {
    creatorWallet: args.creatorWallet,
    totalLaunches,
    successfulLaunches,
    failedLaunches,
    bestMarketCap,
    trustScore,
  };
}

export async function getCreatorTrust(creatorWallet: string | null) {
  if (!creatorWallet) {
    return {
      trustScore: 50,
      label: 'UNKNOWN',
      totalLaunches: 0,
      bestMarketCap: 0,
    };
  }

  const { data, error } = await supabase
    .from('creator_intelligence')
    .select('*')
    .eq('creator_wallet', creatorWallet)
    .maybeSingle();

  if (error || !data) {
    return {
      trustScore: 50,
      label: 'UNKNOWN',
      totalLaunches: 0,
      bestMarketCap: 0,
    };
  }

  const trustScore = Number(data.trust_score ?? 50);

  const label =
    trustScore >= 80
      ? 'PROVEN'
      : trustScore >= 65
        ? 'PROMISING'
        : trustScore >= 45
          ? 'UNKNOWN'
          : 'RISKY';

  return {
    trustScore,
    label,
    totalLaunches: Number(data.total_launches ?? 0),
    bestMarketCap: Number(data.best_market_cap ?? 0),
  };
}