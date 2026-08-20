export type PonsAlphaState =
  | 'WATCHING'
  | 'FLAT_DEAD'
  | 'MOMENTUM_BUILDING'
  | 'ENTRY_WINDOW'
  | 'FAST_BREAKOUT'
  | 'DO_NOT_CHASE'
  | 'FADING'
  | 'QUOTE_UNAVAILABLE';

export type PonsAlphaClassification = {
  state: PonsAlphaState;

  reason: string;

  actionable: boolean;

  strength:
    | 'NONE'
    | 'LOW'
    | 'MEDIUM'
    | 'HIGH'
    | 'EXTREME';

  currentRoi: number | null;

  previousRoi: number | null;

  roiChange: number | null;

  recentPeakRoi: number | null;

  dropFromPeak: number | null;
};

export type PonsAlphaInput = {
  elapsedSec: number;

  currentRoi:
    number | null;

  roi5s?:
    number | null;

  roi10s?:
    number | null;

  roi30s?:
    number | null;

  roi1m?:
    number | null;

  roi2m?:
    number | null;

  peakRoi?:
    number | null;
};

function validNumber(
  value: unknown,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  );
}

function latestPreviousRoi(
  input: PonsAlphaInput,
): number | null {
  const checkpoints = [
    {
      time: 120,
      value: input.roi2m,
    },
    {
      time: 60,
      value: input.roi1m,
    },
    {
      time: 30,
      value: input.roi30s,
    },
    {
      time: 10,
      value: input.roi10s,
    },
    {
      time: 5,
      value: input.roi5s,
    },
  ];

  for (
    const checkpoint
    of checkpoints
  ) {
    /*
     * Do not compare current ROI with a
     * checkpoint that belongs to the same
     * instant or to the future.
     */
    if (
      checkpoint.time <
        input.elapsedSec &&
      validNumber(
        checkpoint.value,
      )
    ) {
      return checkpoint.value;
    }
  }

  return null;
}

function calculateRecentPeak(
  input: PonsAlphaInput,
): number | null {
  const values = [
    input.currentRoi,
    input.roi5s,
    input.roi10s,
    input.roi30s,
    input.roi1m,
    input.roi2m,
    input.peakRoi,
  ].filter(
    validNumber,
  );

  if (!values.length) {
    return null;
  }

  return Math.max(...values);
}

function approximatelyFlat(
  values: Array<
    number | null | undefined
  >,
): boolean {
  const clean =
    values.filter(
      validNumber,
    );

  if (clean.length < 2) {
    return false;
  }

  const highest =
    Math.max(...clean);

  const lowest =
    Math.min(...clean);

  return (
    highest -
      lowest <
    0.75
  );
}

export function classifyPonsAlpha(
  input: PonsAlphaInput,
): PonsAlphaClassification {
  const currentRoi =
    input.currentRoi;

  if (
    !validNumber(
      currentRoi,
    )
  ) {
    return {
      state:
        'QUOTE_UNAVAILABLE',

      reason:
        'Current curve valuation is unavailable. Retry without treating this as a dump.',

      actionable:
        false,

      strength:
        'NONE',

      currentRoi:
        null,

      previousRoi:
        null,

      roiChange:
        null,

      recentPeakRoi:
        null,

      dropFromPeak:
        null,
    };
  }

  const previousRoi =
    latestPreviousRoi(
      input,
    );

  const roiChange =
    previousRoi == null
      ? null
      : currentRoi -
        previousRoi;

  const recentPeakRoi =
    calculateRecentPeak(
      input,
    );

  const dropFromPeak =
    recentPeakRoi == null
      ? null
      : currentRoi -
        recentPeakRoi;

  /*
   * ===================================================
   * 1. EXTREME / CHASE PROTECTION
   * ===================================================
   *
   * A huge early move is exciting but is
   * not automatically a safe entry.
   *
   * Example from live PONS data:
   * +68.93% @ 5s
   * +60.63% @ 10s
   * +25.55% @ 30s
   */
  if (
    currentRoi >= 50
  ) {
    return {
      state:
        'DO_NOT_CHASE',

      reason:
        `Already extended to +${currentRoi.toFixed(
          2,
        )}%. Wait for a new setup rather than chasing.`,

      actionable:
        false,

      strength:
        'EXTREME',

      currentRoi,
      previousRoi,
      roiChange,
      recentPeakRoi,
      dropFromPeak,
    };
  }

  /*
   * ===================================================
   * 2. FADING / REVERSAL
   * ===================================================
   */
  if (
    dropFromPeak != null &&
    recentPeakRoi != null &&
    recentPeakRoi >= 5 &&
    dropFromPeak <= -10
  ) {
    return {
      state:
        'FADING',

      reason:
        `Momentum reversed ${Math.abs(
          dropFromPeak,
        ).toFixed(
          2,
        )}% from the recent peak.`,

      actionable:
        false,

      strength:
        'LOW',

      currentRoi,
      previousRoi,
      roiChange,
      recentPeakRoi,
      dropFromPeak,
    };
  }

  if (
    roiChange != null &&
    roiChange <= -8
  ) {
    return {
      state:
        'FADING',

      reason:
        `Curve ROI deteriorated ${Math.abs(
          roiChange,
        ).toFixed(
          2,
        )}% since the previous checkpoint.`,

      actionable:
        false,

      strength:
        'LOW',

      currentRoi,
      previousRoi,
      roiChange,
      recentPeakRoi,
      dropFromPeak,
    };
  }

  /*
   * ===================================================
   * 3. FAST BREAKOUT
   * ===================================================
   *
   * Strong early move, but not yet in the
   * extreme chase zone.
   *
   * Shadow only for now.
   */
  if (
    input.elapsedSec <= 60 &&
    currentRoi >= 20 &&
    currentRoi < 50
  ) {
    return {
      state:
        'FAST_BREAKOUT',

      reason:
        `Strong early curve expansion: +${currentRoi.toFixed(
          2,
        )}% within ${Math.floor(
          input.elapsedSec,
        )}s.`,

      actionable:
        false,

      strength:
        'HIGH',

      currentRoi,
      previousRoi,
      roiChange,
      recentPeakRoi,
      dropFromPeak,
    };
  }

  /*
   * ===================================================
   * 4. ENTRY WINDOW
   * ===================================================
   *
   * We are deliberately looking for
   * confirmed acceleration rather than
   * blindly buying the launch.
   *
   * Example:
   * -2.61% -> +9.35% -> +18.51%
   */
  if (
    input.elapsedSec >= 10 &&
    input.elapsedSec <= 180 &&
    currentRoi >= 3 &&
    currentRoi <= 20 &&
    roiChange != null &&
    roiChange >= 4
  ) {
    return {
      state:
        'ENTRY_WINDOW',

      reason:
        `Confirmed acceleration: ROI improved ${roiChange.toFixed(
          2,
        )}% to +${currentRoi.toFixed(
          2,
        )}%.`,

      actionable:
        true,

      strength:
        currentRoi >= 10
          ? 'HIGH'
          : 'MEDIUM',

      currentRoi,
      previousRoi,
      roiChange,
      recentPeakRoi,
      dropFromPeak,
    };
  }

  /*
   * Positive and holding, but without a
   * sufficiently strong acceleration yet.
   */
  if (
    currentRoi > 0 &&
    currentRoi < 20
  ) {
    return {
      state:
        'MOMENTUM_BUILDING',

      reason:
        `Curve is positive at +${currentRoi.toFixed(
          2,
        )}% but entry confirmation is incomplete.`,

      actionable:
        false,

      strength:
        currentRoi >= 8
          ? 'MEDIUM'
          : 'LOW',

      currentRoi,
      previousRoi,
      roiChange,
      recentPeakRoi,
      dropFromPeak,
    };
  }

  /*
   * Negative ROI can still become a late
   * breakout. Do not permanently reject it
   * too early.
   */
  if (
    currentRoi <= 0 &&
    roiChange != null &&
    roiChange >= 2
  ) {
    return {
      state:
        'MOMENTUM_BUILDING',

      reason:
        `Still negative, but curve ROI improved ${roiChange.toFixed(
          2,
        )}% since the previous checkpoint.`,

      actionable:
        false,

      strength:
        'LOW',

      currentRoi,
      previousRoi,
      roiChange,
      recentPeakRoi,
      dropFromPeak,
    };
  }

  /*
   * ===================================================
   * 5. FLAT / DEAD
   * ===================================================
   *
   * Do not declare a token dead at second
   * five. Give it enough observation time.
   */
  if (
    input.elapsedSec >= 30 &&
    currentRoi <= 0 &&
    approximatelyFlat([
      input.roi5s,
      input.roi10s,
      input.roi30s,
      currentRoi,
    ])
  ) {
    return {
      state:
        'FLAT_DEAD',

      reason:
        `No meaningful curve expansion after ${Math.floor(
          input.elapsedSec,
        )}s.`,

      actionable:
        false,

      strength:
        'NONE',

      currentRoi,
      previousRoi,
      roiChange,
      recentPeakRoi,
      dropFromPeak,
    };
  }

  return {
    state:
      'WATCHING',

    reason:
      'No confirmed AlphaOS PONS setup yet.',

    actionable:
      false,

    strength:
      'NONE',

    currentRoi,
    previousRoi,
    roiChange,
    recentPeakRoi,
    dropFromPeak,
  };
}
