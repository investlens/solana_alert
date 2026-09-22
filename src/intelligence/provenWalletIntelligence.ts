/**
 * Proven-wallet policy for Robinhood/PONS.
 *
 * Pure/provider-free by design. It scores outcomes AlphaOS already stores and
 * formats discovery evidence. It MUST NOT scan chains, query providers, write
 * Supabase, or send Telegram messages.
 */
export type ProvenWalletStats = {
  completedTrades: number;
  profitableTrades?: number | null;
  consecutiveProfitableTrades?: number | null;
  winRate: number;
  avgMaxReturn: number;
  bestReturn: number;
  realisedRoi?: number | null;
  earlyEntryRate?: number | null;
};

export type ProvenWalletDecision = {
  proven: boolean;
  discoveryAlertEligible: boolean;
  tier: 'PROVEN' | 'WATCH' | 'INSUFFICIENT_HISTORY';
  score: number;
  reasons: string[];
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function classifyProvenWallet(stats: ProvenWalletStats): ProvenWalletDecision {
  const completed = Math.max(0, Math.floor(finite(stats.completedTrades)));
  const profitable = Math.max(0, Math.floor(finite(stats.profitableTrades)));
  const streak = Math.max(0, Math.floor(finite(stats.consecutiveProfitableTrades)));
  const winRate = clamp(finite(stats.winRate));
  const avgMax = finite(stats.avgMaxReturn);
  const best = finite(stats.bestReturn);
  const realised = stats.realisedRoi == null ? null : finite(stats.realisedRoi);
  const early = stats.earlyEntryRate == null ? null : clamp(finite(stats.earlyEntryRate));

  const reasons: string[] = [];
  let score = 0;

  if (completed >= 20) score += 25;
  else if (completed >= 10) score += 20;
  else if (completed >= 5) score += 12;
  else reasons.push('fewer than 5 completed trades');

  if (winRate >= 65) score += 30;
  else if (winRate >= 50) score += 20;
  else if (winRate >= 40) score += 10;

  if (avgMax >= 150) score += 25;
  else if (avgMax >= 75) score += 18;
  else if (avgMax >= 30) score += 8;

  if (best >= 500) score += 10;
  else if (best >= 200) score += 6;

  if (realised != null) {
    if (realised >= 75) score += 10;
    else if (realised < 0) score -= 10;
  }

  if (early != null && early >= 50) score += 5;
  if (streak >= 5) score += 5;
  score = Math.round(clamp(score));

  // PROVEN may use completed token outcomes, but a user-facing discovery alert
  // is deliberately stricter: five consecutive profitable completed trades.
  const repeatable = completed >= 5 && winRate >= 50 && avgMax >= 30;
  const realisedSafe = realised == null || realised >= 0;
  const proven = repeatable && realisedSafe && score >= 70;
  const discoveryAlertEligible =
    proven &&
    profitable >= 5 &&
    streak >= 5 &&
    realised != null &&
    realised > 0;

  if (proven) reasons.push('repeatable profitable history');
  if (streak >= 5) reasons.push('5+ consecutive profitable completed trades');
  if (realised == null) reasons.push('realised ROI not yet available; discovery alert blocked');
  if (proven && !discoveryAlertEligible) reasons.push('proven profile retained in watch mode; user alert threshold not met');

  return {
    proven,
    discoveryAlertEligible,
    tier: proven ? 'PROVEN' : completed < 5 ? 'INSUFFICIENT_HISTORY' : 'WATCH',
    score,
    reasons,
  };
}

export function walletConvergenceKey(token: string, wallet: string) {
  return `${token.trim().toLowerCase()}:${wallet.trim().toLowerCase()}`;
}

export function profitableWalletDiscoveryIdentity(wallet: string) {
  return `profitable-wallet:${wallet.trim().toLowerCase()}`;
}
