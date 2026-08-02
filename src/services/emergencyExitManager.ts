export type EmergencyExitReason =
  | "TRAILING_STOP"
  | "HARD_STOP_LOSS"
  | "LIQUIDITY_COLLAPSE"
  | "BUY_SELL_FLOW_COLLAPSE"
  | "SINGLE_HOLDER_CONCENTRATION"
  | "TOP_5_HOLDER_CONCENTRATION"
  | "TOP_10_HOLDER_CONCENTRATION"
  | "RAPID_HOLDER_CONCENTRATION"
  | "CREATOR_CONCENTRATION"
  | "BUNDLE_SELL";

export type EmergencyExitSeverity =
  | "NONE"
  | "WARNING"
  | "CRITICAL";

export type EmergencyExitInput = {
  token: string;
  symbol: string;

  entryPrice: number;
  currentPrice: number;
  highestPrice: number;
  stopPrice: number;

  initialLiquidityUsd?: number | null;
  currentLiquidityUsd?: number | null;

  buys5m?: number | null;
  sells5m?: number | null;

  holderProtectionEnabled?: boolean;
  holderDataAvailable?: boolean;

  largestHolderPercent?: number | null;
  top5HolderPercent?: number | null;
  top10HolderPercent?: number | null;
  creatorHolderPercent?: number | null;
  rapidHolderIncreasePercent?: number | null;

  bundleProtectionEnabled?: boolean;
  bundleRiskScore?: number | null;
  coordinatedSellDetected?: boolean;
};

export type EmergencyExitDecision = {
  shouldExit: boolean;
  severity: EmergencyExitSeverity;
  reason: EmergencyExitReason | null;
  message: string | null;

  metrics: {
    roiPercent: number;
    liquidityDropPercent: number | null;
    buySellRatio: number | null;

    largestHolderPercent: number | null;
    top5HolderPercent: number | null;
    top10HolderPercent: number | null;
    creatorHolderPercent: number | null;
    rapidHolderIncreasePercent: number | null;

    bundleRiskScore: number | null;
  };
};

const LIMITS = {
  /*
   * Price protection
   */
  hardStopLossPercent: 12,

  /*
   * Market structure
   */
  liquidityDropExitPercent: 30,
  minimumDangerousBuySellRatio: 0.55,
  minimumTransactionsForFlowExit: 50,

  /*
   * Holder protection.
   *
   * These are ignored until holderProtectionEnabled
   * and holderDataAvailable are both true.
   */
  largestHolderExitPercent: 12,
  top5HolderExitPercent: 35,
  top10HolderExitPercent: 50,
  creatorHolderExitPercent: 10,
  rapidHolderIncreaseExitPercent: 5,

  /*
   * Bundle protection
   */
  bundleRiskExitScore: 80,
};

function finiteOrNull(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function percentageDrop(
  original: number | null,
  current: number | null,
): number | null {
  if (
    original == null ||
    current == null ||
    original <= 0
  ) {
    return null;
  }

  return ((original - current) / original) * 100;
}

function createDecision(args: {
  shouldExit: boolean;
  severity: EmergencyExitSeverity;
  reason: EmergencyExitReason | null;
  message: string | null;
  metrics: EmergencyExitDecision["metrics"];
}): EmergencyExitDecision {
  return {
    shouldExit: args.shouldExit,
    severity: args.severity,
    reason: args.reason,
    message: args.message,
    metrics: args.metrics,
  };
}

export function evaluateEmergencyExit(
  input: EmergencyExitInput,
): EmergencyExitDecision {
  const entryPrice = finiteOrNull(input.entryPrice) ?? 0;
  const currentPrice = finiteOrNull(input.currentPrice) ?? 0;
  const stopPrice = finiteOrNull(input.stopPrice) ?? 0;

  const roiPercent =
    entryPrice > 0
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : 0;

  const liquidityDropPercent = percentageDrop(
    finiteOrNull(input.initialLiquidityUsd),
    finiteOrNull(input.currentLiquidityUsd),
  );

  const buys5m = Math.max(
    0,
    finiteOrNull(input.buys5m) ?? 0,
  );

  const sells5m = Math.max(
    0,
    finiteOrNull(input.sells5m) ?? 0,
  );

  const buySellRatio =
    sells5m > 0
      ? buys5m / sells5m
      : buys5m > 0
        ? buys5m
        : null;

  const largestHolderPercent =
    finiteOrNull(input.largestHolderPercent);

  const top5HolderPercent =
    finiteOrNull(input.top5HolderPercent);

  const top10HolderPercent =
    finiteOrNull(input.top10HolderPercent);

  const creatorHolderPercent =
    finiteOrNull(input.creatorHolderPercent);

  const rapidHolderIncreasePercent =
    finiteOrNull(input.rapidHolderIncreasePercent);

  const bundleRiskScore =
    finiteOrNull(input.bundleRiskScore);

  const metrics: EmergencyExitDecision["metrics"] = {
    roiPercent,
    liquidityDropPercent,
    buySellRatio,

    largestHolderPercent,
    top5HolderPercent,
    top10HolderPercent,
    creatorHolderPercent,
    rapidHolderIncreasePercent,

    bundleRiskScore,
  };

  /*
   * Priority 1:
   * Existing trailing stop.
   */
  if (
    currentPrice > 0 &&
    stopPrice > 0 &&
    currentPrice <= stopPrice
  ) {
    return createDecision({
      shouldExit: true,
      severity: "CRITICAL",
      reason: "TRAILING_STOP",
      message:
        `Current price crossed the protected stop price.`,
      metrics,
    });
  }

  /*
   * Priority 2:
   * Independent hard loss limit.
   */
  if (roiPercent <= -LIMITS.hardStopLossPercent) {
    return createDecision({
      shouldExit: true,
      severity: "CRITICAL",
      reason: "HARD_STOP_LOSS",
      message:
        `Position reached ${roiPercent.toFixed(1)}% ROI.`,
      metrics,
    });
  }

  /*
   * Priority 3:
   * Liquidity collapse.
   */
  if (
    liquidityDropPercent != null &&
    liquidityDropPercent >=
      LIMITS.liquidityDropExitPercent
  ) {
    return createDecision({
      shouldExit: true,
      severity: "CRITICAL",
      reason: "LIQUIDITY_COLLAPSE",
      message:
        `Liquidity dropped ${liquidityDropPercent.toFixed(1)}%.`,
      metrics,
    });
  }

  /*
   * Priority 4:
   * Severe order-flow deterioration.
   *
   * Require enough transactions to avoid reacting
   * to tiny samples such as 2 buys and 4 sells.
   */
  const totalTransactions = buys5m + sells5m;

  if (
    totalTransactions >=
      LIMITS.minimumTransactionsForFlowExit &&
    buySellRatio != null &&
    buySellRatio <=
      LIMITS.minimumDangerousBuySellRatio
  ) {
    return createDecision({
      shouldExit: true,
      severity: "CRITICAL",
      reason: "BUY_SELL_FLOW_COLLAPSE",
      message:
        `Buy/sell ratio fell to ${buySellRatio.toFixed(2)}.`,
      metrics,
    });
  }

  /*
   * Holder exits remain disabled until our percentage
   * calculation uses total supply and excludes pool,
   * bonding-curve, burn, vault and AlphaOS accounts.
   */
  if (
    input.holderProtectionEnabled === true &&
    input.holderDataAvailable === true
  ) {
    if (
      largestHolderPercent != null &&
      largestHolderPercent >=
        LIMITS.largestHolderExitPercent
    ) {
      return createDecision({
        shouldExit: true,
        severity: "CRITICAL",
        reason: "SINGLE_HOLDER_CONCENTRATION",
        message:
          `Largest real holder controls ` +
          `${largestHolderPercent.toFixed(1)}%.`,
        metrics,
      });
    }

    if (
      top5HolderPercent != null &&
      top5HolderPercent >=
        LIMITS.top5HolderExitPercent
    ) {
      return createDecision({
        shouldExit: true,
        severity: "CRITICAL",
        reason: "TOP_5_HOLDER_CONCENTRATION",
        message:
          `Top five real holders control ` +
          `${top5HolderPercent.toFixed(1)}%.`,
        metrics,
      });
    }

    if (
      top10HolderPercent != null &&
      top10HolderPercent >=
        LIMITS.top10HolderExitPercent
    ) {
      return createDecision({
        shouldExit: true,
        severity: "CRITICAL",
        reason: "TOP_10_HOLDER_CONCENTRATION",
        message:
          `Top ten real holders control ` +
          `${top10HolderPercent.toFixed(1)}%.`,
        metrics,
      });
    }

    if (
      creatorHolderPercent != null &&
      creatorHolderPercent >=
        LIMITS.creatorHolderExitPercent
    ) {
      return createDecision({
        shouldExit: true,
        severity: "CRITICAL",
        reason: "CREATOR_CONCENTRATION",
        message:
          `Creator-associated holdings reached ` +
          `${creatorHolderPercent.toFixed(1)}%.`,
        metrics,
      });
    }

    if (
      rapidHolderIncreasePercent != null &&
      rapidHolderIncreasePercent >=
        LIMITS.rapidHolderIncreaseExitPercent
    ) {
      return createDecision({
        shouldExit: true,
        severity: "CRITICAL",
        reason: "RAPID_HOLDER_CONCENTRATION",
        message:
          `Holder concentration increased by ` +
          `${rapidHolderIncreasePercent.toFixed(1)} points.`,
        metrics,
      });
    }
  }

  /*
   * Bundle exits also remain independently switchable.
   */
  if (input.bundleProtectionEnabled === true) {
    if (input.coordinatedSellDetected === true) {
      return createDecision({
        shouldExit: true,
        severity: "CRITICAL",
        reason: "BUNDLE_SELL",
        message:
          "Coordinated selling was detected across linked wallets.",
        metrics,
      });
    }

    if (
      bundleRiskScore != null &&
      bundleRiskScore >= LIMITS.bundleRiskExitScore
    ) {
      return createDecision({
        shouldExit: true,
        severity: "CRITICAL",
        reason: "BUNDLE_SELL",
        message:
          `Bundle risk reached ${bundleRiskScore.toFixed(0)}/100.`,
        metrics,
      });
    }
  }

  /*
   * Warning-only conditions.
   */
  if (
    liquidityDropPercent != null &&
    liquidityDropPercent >= 15
  ) {
    return createDecision({
      shouldExit: false,
      severity: "WARNING",
      reason: null,
      message:
        `Liquidity has declined ${liquidityDropPercent.toFixed(1)}%.`,
      metrics,
    });
  }

  return createDecision({
    shouldExit: false,
    severity: "NONE",
    reason: null,
    message: null,
    metrics,
  });
}

export function getEmergencyExitLimits() {
  return {
    ...LIMITS,
  };
}