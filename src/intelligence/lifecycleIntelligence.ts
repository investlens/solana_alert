export type LifecycleSignal =
  | "GRADUATION_BREAKOUT"
  | "REVIVAL"
  | "WALLET_CONVERGENCE"
  | "PROVEN_CREATOR_RELAUNCH"
  | "LIQUIDITY_HOLDER_ACCELERATION";

export type LifecycleObservation = {
  chain: "PONS" | "ROBINHOOD" | "ARC" | "SOLANA";
  tokenAddress: string;
  symbol?: string;
  ageMinutes?: number;
  liquidityUsd?: number;
  previousLiquidityUsd?: number;
  volume5mUsd?: number;
  buys5m?: number;
  sells5m?: number;
  priceChange5mPct?: number;
  drawdownFromHighPct?: number;
  uniqueSmartWalletBuyers?: number;
  creatorPriorWins?: number;
  creatorHoldingVerified?: boolean;
  creatorBurnVerified?: boolean;
  graduated?: boolean;
};

export type LifecycleDecision = {
  mode: "SHADOW";
  signals: LifecycleSignal[];
  reasons: string[];
};

/**
 * Pure, zero-I/O lifecycle classifier.
 *
 * Important: this module does not poll RPCs, query Supabase, or send Telegram
 * messages. Existing scanners can feed observations into it later. Keeping the
 * classifier pure lets us validate lifecycle intelligence without changing any
 * current alert path or adding Railway services.
 */
export function classifyLifecycleObservation(
  observation: LifecycleObservation,
): LifecycleDecision {
  const signals: LifecycleSignal[] = [];
  const reasons: string[] = [];

  if (
    observation.graduated === true &&
    (observation.liquidityUsd ?? 0) >= 10_000 &&
    (observation.volume5mUsd ?? 0) >= 3_000
  ) {
    signals.push("GRADUATION_BREAKOUT");
    reasons.push("graduated with usable liquidity and fresh volume");
  }

  if (
    (observation.ageMinutes ?? 0) >= 30 &&
    (observation.drawdownFromHighPct ?? 0) <= -35 &&
    (observation.priceChange5mPct ?? 0) > 0 &&
    (observation.buys5m ?? 0) > (observation.sells5m ?? 0) &&
    (observation.creatorHoldingVerified === true ||
      observation.creatorBurnVerified === true)
  ) {
    signals.push("REVIVAL");
    reasons.push("post-drawdown reversal with verified creator safety");
  }

  if ((observation.uniqueSmartWalletBuyers ?? 0) >= 3) {
    signals.push("WALLET_CONVERGENCE");
    reasons.push("three or more independent tracked smart wallets converged");
  }

  if ((observation.creatorPriorWins ?? 0) >= 2) {
    signals.push("PROVEN_CREATOR_RELAUNCH");
    reasons.push("creator has multiple prior successful launches");
  }

  const liquidityGrowth =
    observation.previousLiquidityUsd && observation.previousLiquidityUsd > 0
      ? ((observation.liquidityUsd ?? 0) - observation.previousLiquidityUsd) /
        observation.previousLiquidityUsd
      : 0;

  if (
    liquidityGrowth >= 0.5 &&
    (observation.volume5mUsd ?? 0) >= 3_000 &&
    (observation.buys5m ?? 0) > (observation.sells5m ?? 0)
  ) {
    signals.push("LIQUIDITY_HOLDER_ACCELERATION");
    reasons.push("liquidity expanded >=50% while buy-side activity remained positive");
  }

  return { mode: "SHADOW", signals, reasons };
}
