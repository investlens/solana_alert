export type HolderRiskExitReason =
  | "SINGLE_HOLDER_CONCENTRATION"
  | "TOP_5_CONCENTRATION"
  | "TOP_10_CONCENTRATION"
  | "CREATOR_CONCENTRATION"
  | "RAPID_CONCENTRATION_INCREASE"
  | null;

export type HolderRiskSnapshot = {
  token: string;
  checkedAt: number;

  largestHolderPercent: number;
  top5Percent: number;
  top10Percent: number;
  creatorPercent: number | null;

  riskScore: number;
  warning: boolean;
  emergencyExit: boolean;
  exitReason: HolderRiskExitReason;

  source: "placeholder";
};

export type HolderRiskThresholds = {
  largestHolderWarningPercent: number;
  largestHolderExitPercent: number;

  top5WarningPercent: number;
  top5ExitPercent: number;

  top10WarningPercent: number;
  top10ExitPercent: number;

  creatorWarningPercent: number;
  creatorExitPercent: number;

  rapidIncreaseExitPercent: number;
};

const DEFAULT_THRESHOLDS: HolderRiskThresholds = {
  largestHolderWarningPercent: 8,
  largestHolderExitPercent: 12,

  top5WarningPercent: 25,
  top5ExitPercent: 35,

  top10WarningPercent: 40,
  top10ExitPercent: 50,

  creatorWarningPercent: 5,
  creatorExitPercent: 10,

  rapidIncreaseExitPercent: 5,
};

const latestSnapshots = new Map<string, HolderRiskSnapshot>();

function clampRiskScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function calculateRiskScore(args: {
  largestHolderPercent: number;
  top5Percent: number;
  top10Percent: number;
  creatorPercent: number | null;
}) {
  const creatorPercent = args.creatorPercent ?? 0;

  const largestRisk =
    (args.largestHolderPercent /
      DEFAULT_THRESHOLDS.largestHolderExitPercent) *
    35;

  const top5Risk =
    (args.top5Percent / DEFAULT_THRESHOLDS.top5ExitPercent) * 30;

  const top10Risk =
    (args.top10Percent / DEFAULT_THRESHOLDS.top10ExitPercent) *
    25;

  const creatorRisk =
    (creatorPercent / DEFAULT_THRESHOLDS.creatorExitPercent) *
    10;

  return clampRiskScore(
    largestRisk + top5Risk + top10Risk + creatorRisk,
  );
}

function determineExitReason(args: {
  largestHolderPercent: number;
  top5Percent: number;
  top10Percent: number;
  creatorPercent: number | null;
  previous?: HolderRiskSnapshot | null;
}): HolderRiskExitReason {
  if (
    args.largestHolderPercent >=
    DEFAULT_THRESHOLDS.largestHolderExitPercent
  ) {
    return "SINGLE_HOLDER_CONCENTRATION";
  }

  if (args.top5Percent >= DEFAULT_THRESHOLDS.top5ExitPercent) {
    return "TOP_5_CONCENTRATION";
  }

  if (args.top10Percent >= DEFAULT_THRESHOLDS.top10ExitPercent) {
    return "TOP_10_CONCENTRATION";
  }

  if (
    args.creatorPercent != null &&
    args.creatorPercent >=
      DEFAULT_THRESHOLDS.creatorExitPercent
  ) {
    return "CREATOR_CONCENTRATION";
  }

  if (args.previous) {
    const largestIncrease =
      args.largestHolderPercent -
      args.previous.largestHolderPercent;

    const top5Increase =
      args.top5Percent - args.previous.top5Percent;

    if (
      largestIncrease >=
        DEFAULT_THRESHOLDS.rapidIncreaseExitPercent ||
      top5Increase >= DEFAULT_THRESHOLDS.rapidIncreaseExitPercent
    ) {
      return "RAPID_CONCENTRATION_INCREASE";
    }
  }

  return null;
}

function determineWarning(args: {
  largestHolderPercent: number;
  top5Percent: number;
  top10Percent: number;
  creatorPercent: number | null;
}) {
  return (
    args.largestHolderPercent >=
      DEFAULT_THRESHOLDS.largestHolderWarningPercent ||
    args.top5Percent >= DEFAULT_THRESHOLDS.top5WarningPercent ||
    args.top10Percent >=
      DEFAULT_THRESHOLDS.top10WarningPercent ||
    (args.creatorPercent != null &&
      args.creatorPercent >=
        DEFAULT_THRESHOLDS.creatorWarningPercent)
  );
}

/*
 * Placeholder analyser.
 *
 * In the next step we will connect this to the existing
 * Solana holder-data source and exclude LP, bonding curve,
 * burn, program and AlphaOS wallet accounts.
 */
export async function refreshHolderRisk(
  token: string,
): Promise<HolderRiskSnapshot> {
  const previous = latestSnapshots.get(token) ?? null;

  const largestHolderPercent = 0;
  const top5Percent = 0;
  const top10Percent = 0;
  const creatorPercent: number | null = null;

  const exitReason = determineExitReason({
    largestHolderPercent,
    top5Percent,
    top10Percent,
    creatorPercent,
    previous,
  });

  const snapshot: HolderRiskSnapshot = {
    token,
    checkedAt: Date.now(),

    largestHolderPercent,
    top5Percent,
    top10Percent,
    creatorPercent,

    riskScore: calculateRiskScore({
      largestHolderPercent,
      top5Percent,
      top10Percent,
      creatorPercent,
    }),

    warning: determineWarning({
      largestHolderPercent,
      top5Percent,
      top10Percent,
      creatorPercent,
    }),

    emergencyExit: exitReason !== null,
    exitReason,

    source: "placeholder",
  };

  latestSnapshots.set(token, snapshot);

  return snapshot;
}

export function getLatestHolderRisk(
  token: string,
): HolderRiskSnapshot | null {
  return latestSnapshots.get(token) ?? null;
}

export function clearHolderRisk(token: string) {
  latestSnapshots.delete(token);
}

export function getHolderRiskThresholds() {
  return {
    ...DEFAULT_THRESHOLDS,
  };
}