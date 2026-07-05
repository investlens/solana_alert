import { supabase } from '../services/supabase.js';

export type CreatorRating =
  | 'PROVEN'
  | 'PROMISING'
  | 'UNKNOWN'
  | 'RISKY'
  | 'AVOID';

export type CreatorProfile = {
  wallet: string | null;
  rating: CreatorRating;
  trustScore: number;

  launches: number;
  successfulLaunches: number;
  failedLaunches: number;
  rugs: number;

  highestMarketCap: number;
  averageMarketCap: number;

  bestToken: string | null;
  bestSymbol: string | null;

  summary: string;
  hasData: boolean;
};

function num(value: unknown, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function ratingFromScore(score: number): CreatorRating {
  if (score >= 80) return 'PROVEN';
  if (score >= 65) return 'PROMISING';
  if (score >= 45) return 'UNKNOWN';
  if (score >= 25) return 'RISKY';
  return 'AVOID';
}

function buildSummary(profile: Omit<CreatorProfile, 'summary'>) {
  if (!profile.wallet) {
    return 'Creator wallet is not available from the current data source.';
  }

  if (!profile.hasData) {
    return 'AlphaOS has not collected enough historical creator data yet.';
  }

  if (profile.rating === 'PROVEN') {
    return `Creator appears proven with ${profile.launches} tracked launches, ${profile.successfulLaunches} successful launches and a highest tracked market cap of $${Math.round(profile.highestMarketCap).toLocaleString()}.`;
  }

  if (profile.rating === 'PROMISING') {
    return `Creator shows promising history with ${profile.launches} tracked launches and a trust score of ${profile.trustScore}/100.`;
  }

  if (profile.rating === 'RISKY' || profile.rating === 'AVOID') {
    return `Creator history shows elevated risk with ${profile.failedLaunches} failed launches and a trust score of ${profile.trustScore}/100.`;
  }

  return `Creator has limited tracked history. AlphaOS found ${profile.launches} launches with a trust score of ${profile.trustScore}/100.`;
}

export async function getCreatorProfile(
  creatorWallet: string | null | undefined
): Promise<CreatorProfile> {
  if (!creatorWallet) {
    const base = {
      wallet: null,
      rating: 'UNKNOWN' as CreatorRating,
      trustScore: 50,
      launches: 0,
      successfulLaunches: 0,
      failedLaunches: 0,
      rugs: 0,
      highestMarketCap: 0,
      averageMarketCap: 0,
      bestToken: null,
      bestSymbol: null,
      hasData: false,
    };

    return {
      ...base,
      summary: buildSummary(base),
    };
  }

  const [creatorIntel, creatorStats, provenCreator] = await Promise.all([
    supabase
      .from('creator_intelligence')
      .select('*')
      .eq('creator_wallet', creatorWallet)
      .maybeSingle(),

    supabase
      .from('creator_stats')
      .select('*')
      .eq('creator_wallet', creatorWallet)
      .maybeSingle(),

    supabase
      .from('proven_creators')
      .select('*')
      .eq('creator_wallet', creatorWallet)
      .maybeSingle(),
  ]);

  if (creatorIntel.error) {
    console.log('creator_intelligence lookup error:', creatorIntel.error.message);
  }

  if (creatorStats.error) {
    console.log('creator_stats lookup error:', creatorStats.error.message);
  }

  if (provenCreator.error) {
    console.log('proven_creators lookup error:', provenCreator.error.message);
  }

  const intel = creatorIntel.data as any;
  const stats = creatorStats.data as any;
  const proven = provenCreator.data as any;

  const hasData = Boolean(intel || stats || proven);

  const launches =
    num(intel?.total_launches) ||
    num(stats?.total_launches);

  const successfulLaunches =
    num(intel?.successful_launches) ||
    num(stats?.successful_launches);

  const failedLaunches =
    num(intel?.failed_launches) ||
    num(stats?.rugs);

  const rugs = num(stats?.rugs) || 0;

  const highestMarketCap =
    num(proven?.best_market_cap) ||
    num(intel?.best_market_cap) ||
    num(stats?.best_multiple);

  const averageMarketCap =
    num(intel?.avg_market_cap) ||
    num(stats?.avg_multiple);

  const trustScore =
    num(intel?.trust_score, NaN) ||
    num(stats?.trust_score, NaN) ||
    (proven ? 80 : 50);

  const base = {
    wallet: creatorWallet,
    rating: ratingFromScore(trustScore),
    trustScore,
    launches,
    successfulLaunches,
    failedLaunches,
    rugs,
    highestMarketCap,
    averageMarketCap,
    bestToken: proven?.best_token ?? stats?.last_token ?? null,
    bestSymbol: proven?.best_symbol ?? null,
    hasData,
  };

  return {
    ...base,
    summary: buildSummary(base),
  };
}