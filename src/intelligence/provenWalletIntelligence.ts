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


export type ProfitableWalletCandidate = {
  wallet: string;
  stats: ProvenWalletStats;
  excluded?: boolean;
  exclusionReason?: string | null;
};

export type ProfitableWalletDiscovery = {
  wallet: string;
  identity: string;
  decision: ProvenWalletDecision;
};

/**
 * Cheap first-stage funnel. Callers should build these candidates from already
 * available trade outcomes; this function performs no I/O.
 *
 * Only discovery-eligible wallets survive to persistence/delivery. That means
 * AlphaOS does not need to permanently save every observed wallet.
 */
export function selectProfitableWalletDiscoveries(
  candidates: ProfitableWalletCandidate[],
): ProfitableWalletDiscovery[] {
  const unique = new Map<string, ProfitableWalletDiscovery>();

  for (const candidate of candidates) {
    if (candidate.excluded) continue;

    const wallet = candidate.wallet.trim().toLowerCase();
    if (!wallet) continue;

    const decision = classifyProvenWallet(candidate.stats);
    if (!decision.discoveryAlertEligible) continue;

    unique.set(wallet, {
      wallet,
      identity: profitableWalletDiscoveryIdentity(wallet),
      decision,
    });
  }

  return [...unique.values()];
}


export type WalletCompletedTrade = {
  completedAt: string | number | Date;
  realisedReturnPct: number | null;
};

/**
 * Calculates consecutive realised-profit evidence without I/O.
 * A trade with unknown realised return breaks the streak rather than being
 * guessed as profitable. Input is sorted newest-first internally.
 */
export function calculateProfitableTradeHistory(trades: WalletCompletedTrade[]) {
  const ordered = [...trades].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );

  const evaluable = ordered.filter(
    trade => trade.realisedReturnPct != null && Number.isFinite(Number(trade.realisedReturnPct)),
  );

  const profitableTrades = evaluable.filter(
    trade => Number(trade.realisedReturnPct) > 0,
  ).length;

  let consecutiveProfitableTrades = 0;
  for (const trade of ordered) {
    if (trade.realisedReturnPct == null || !Number.isFinite(Number(trade.realisedReturnPct))) break;
    if (Number(trade.realisedReturnPct) <= 0) break;
    consecutiveProfitableTrades += 1;
  }

  const realisedReturns = evaluable.map(trade => Number(trade.realisedReturnPct));
  const averageRealisedRoi = realisedReturns.length
    ? realisedReturns.reduce((sum, value) => sum + value, 0) / realisedReturns.length
    : null;

  return {
    completedTrades: ordered.length,
    evaluableTrades: evaluable.length,
    profitableTrades,
    consecutiveProfitableTrades,
    winRate: evaluable.length ? (profitableTrades / evaluable.length) * 100 : 0,
    averageRealisedRoi,
  };
}
