/**
 * Proven-wallet policy for Robinhood/PONS.
 *
 * Intentionally pure and provider-free: this module scores compact historical
 * outcomes that AlphaOS already stores. It must never trigger chain scans.
 */
export type ProvenWalletStats = {
  completedTrades: number;
  winRate: number;
  avgMaxReturn: number;
  bestReturn: number;
  realisedRoi?: number | null;
  earlyEntryRate?: number | null;
};

export type ProvenWalletDecision = {
  proven: boolean;
  tier: 'PROVEN' | 'WATCH' | 'INSUFFICIENT_HISTORY';
  score: number;
  reasons: string[];
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function classifyProvenWallet(stats: ProvenWalletStats): ProvenWalletDecision {
  const completed = Math.max(0, Math.floor(finite(stats.completedTrades)));
  const winRate = clamp(finite(stats.winRate));
  const avgMax = finite(stats.avgMaxReturn);
  const best = finite(stats.bestReturn);
  const realised = stats.realisedRoi == null ? null : finite(stats.realisedRoi);
  const early = stats.earlyEntryRate == null ? null : clamp(finite(stats.earlyEntryRate));

  const reasons: string[] = [];
  let score = 0;

  // Repeatability matters more than one moonshot.
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

  // Realised ROI is stronger evidence than a token merely reaching a peak.
  if (realised != null) {
    if (realised >= 75) score += 10;
    else if (realised < 0) score -= 10;
  }

  if (early != null && early >= 50) score += 5;
  score = Math.round(clamp(score));

  const repeatable = completed >= 5 && winRate >= 50 && avgMax >= 30;
  const realisedSafe = realised == null || realised >= 0;
  const proven = repeatable && realisedSafe && score >= 70;

  if (proven) reasons.push('repeatable profitable history');
  if (realised == null) reasons.push('realised ROI not yet available; confidence capped by evidence');

  return {
    proven,
    tier: proven ? 'PROVEN' : completed < 5 ? 'INSUFFICIENT_HISTORY' : 'WATCH',
    score,
    reasons,
  };
}

export function walletConvergenceKey(token: string, wallet: string) {
  return `${token.trim().toLowerCase()}:${wallet.trim().toLowerCase()}`;
}
