import type { RiskResult } from '../types.js';

export type MomentumDecision =
  | 'UPTREND'
  | 'WATCH'
  | 'DOWNTREND'
  | 'EXTENDED';

export interface MomentumPolicy {
  maxEntryDipPercent: number;
  maxEntryPumpPercent: number;
  maxLiquidityDropPercent: number;
  minimumBuyRatio: number;
  maximumBuyRatioDropPercent: number;
  maximumScoreDrop: number;
}

export interface MomentumCheckResult {
  decision: MomentumDecision;
  passed: boolean;
  reason: string;
  reasons: string[];
  metrics: {
    priceChangePct: number;
    marketCapChangePct: number;
    liquidityChangePct: number;

    previousBuyRatio: number;
    currentBuyRatio: number;
    buyRatioChangePct: number;

    previousBuys: number;
    currentBuys: number;
    previousSells: number;
    currentSells: number;

    buyChangePct: number;
    sellChangePct: number;

    intervalBuys: number;
    intervalSells: number;
    intervalTransactions: number;
    intervalBuyRatio: number;

    scoreChange: number;
  };
}

const DEFAULT_POLICY: MomentumPolicy = {
  maxEntryDipPercent: 5,
  maxEntryPumpPercent: 15,
  maxLiquidityDropPercent: 12,
  minimumBuyRatio: 1.25,
  maximumBuyRatioDropPercent: 35,
  maximumScoreDrop: 6,
};

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentageChange(
  previousValue: number,
  currentValue: number,
): number {
  if (previousValue <= 0) {
    return currentValue > 0 ? 100 : 0;
  }

  return (
    ((currentValue - previousValue) / previousValue) *
    100
  );
}

function calculateBuyRatio(
  buys: number,
  sells: number,
): number {
  if (sells <= 0) {
    return buys > 0 ? buys : 0;
  }

  return buys / sells;
}

export function confirmMomentum(
  previous: RiskResult,
  current: RiskResult,
  policyOverrides: Partial<MomentumPolicy> = {},
): MomentumCheckResult {
  const policy: MomentumPolicy = {
    ...DEFAULT_POLICY,
    ...policyOverrides,
  };

  const previousPrice = finiteNumber(previous.currentPrice);
  const currentPrice = finiteNumber(current.currentPrice);

  const previousMarketCap = finiteNumber(previous.marketCap);
  const currentMarketCap = finiteNumber(current.marketCap);

  const previousLiquidity = finiteNumber(previous.liquidityUsd);
  const currentLiquidity = finiteNumber(current.liquidityUsd);

  const previousBuys = finiteNumber(previous.buys5m);
  const currentBuys = finiteNumber(current.buys5m);

  const previousSells = finiteNumber(previous.sells5m);
  const currentSells = finiteNumber(current.sells5m);

  const priceChangePct = percentageChange(
    previousPrice,
    currentPrice,
  );

  const marketCapChangePct = percentageChange(
    previousMarketCap,
    currentMarketCap,
  );

  const liquidityChangePct = percentageChange(
    previousLiquidity,
    currentLiquidity,
  );

  const previousBuyRatio = calculateBuyRatio(
    previousBuys,
    previousSells,
  );

  const currentBuyRatio = calculateBuyRatio(
    currentBuys,
    currentSells,
  );

  const buyRatioChangePct = percentageChange(
    previousBuyRatio,
    currentBuyRatio,
  );

  const buyChangePct = percentageChange(
    previousBuys,
    currentBuys,
  );

  const sellChangePct = percentageChange(
    previousSells,
    currentSells,
  );

  /*
  * Activity that occurred specifically during the
  * confirmation window.
  */
  const intervalBuys = Math.max(
    0,
    currentBuys - previousBuys,
  );

  const intervalSells = Math.max(
    0,
    currentSells - previousSells,
  );

  const intervalTransactions =
    intervalBuys + intervalSells;

  const intervalBuyRatio =
    calculateBuyRatio(
      intervalBuys,
      intervalSells,
    );

  const scoreChange =
    finiteNumber(current.score) -
    finiteNumber(previous.score);

  const metrics = {
    priceChangePct,
    marketCapChangePct,
    liquidityChangePct,

    previousBuyRatio,
    currentBuyRatio,
    buyRatioChangePct,

    previousBuys,
    currentBuys,
    previousSells,
    currentSells,

    buyChangePct,
    sellChangePct,

    intervalBuys,
    intervalSells,
    intervalTransactions,
    intervalBuyRatio,

    scoreChange,
  };

  const severeReasons: string[] = [];
  const watchReasons: string[] = [];
  const extendedReasons: string[] = [];

  /*
   * EXTENDED ENTRY
   *
   * The token may still be strong, but it moved too quickly
   * during confirmation. Do not send a late BUY.
   */
  if (
    priceChangePct >= policy.maxEntryPumpPercent ||
    marketCapChangePct >= policy.maxEntryPumpPercent
  ) {
    extendedReasons.push(
      `Token pumped more than ${policy.maxEntryPumpPercent.toFixed(1)}% during confirmation`,
    );
  }

  /*
   * SEVERE REVERSAL CONDITIONS
   */
  if (
    priceChangePct <= -policy.maxEntryDipPercent
  ) {
    severeReasons.push(
      `Price fell ${Math.abs(priceChangePct).toFixed(1)}% during confirmation`,
    );
  }

  if (
    marketCapChangePct <= -policy.maxEntryDipPercent
  ) {
    severeReasons.push(
      `Market cap fell ${Math.abs(marketCapChangePct).toFixed(1)}% during confirmation`,
    );
  }

  if (
    liquidityChangePct <=
    -policy.maxLiquidityDropPercent
  ) {
    severeReasons.push(
      `Liquidity fell ${Math.abs(liquidityChangePct).toFixed(1)}% during confirmation`,
    );
  }

  if (
    currentBuyRatio < policy.minimumBuyRatio
  ) {
    severeReasons.push(
      `Buy ratio weakened to ${currentBuyRatio.toFixed(2)}`,
    );
  }

  if (
    previousBuyRatio > 0 &&
    buyRatioChangePct <=
      -policy.maximumBuyRatioDropPercent
  ) {
    severeReasons.push(
      `Buy ratio collapsed ${Math.abs(buyRatioChangePct).toFixed(1)}%`,
    );
  }

  if (
    scoreChange <= -policy.maximumScoreDrop
  ) {
    severeReasons.push(
      `AI score fell by ${Math.abs(scoreChange).toFixed(0)} points`,
    );
  }

  /*
   * Sell acceleration is especially dangerous when accompanied
   * by weakening price or buying pressure.
   */
  const sellsAccelerating =
    sellChangePct >= 25 &&
    currentSells > previousSells;

  const buyersWeakening =
    buyChangePct <= -15 ||
    currentBuys < previousBuys;

  if (
    sellsAccelerating &&
    (
      priceChangePct < 0 ||
      marketCapChangePct < 0 ||
      buyersWeakening
    )
  ) {
    severeReasons.push(
      `Sell activity accelerated ${sellChangePct.toFixed(1)}% while momentum weakened`,
    );
  }

  /*
  * Reject when the transactions added during the study
  * are clearly sell-dominated and price is not improving.
  *
  * Require at least 12 new transactions to avoid reacting
  * to very small samples.
  */
  if (
    intervalTransactions >= 12 &&
    intervalSells > intervalBuys &&
    priceChangePct <= 0
  ) {
    severeReasons.push(
      `Confirmation flow turned sell-heavy: ` +
        `${intervalBuys} new buys vs ` +
        `${intervalSells} new sells`,
    );
  }

  if (severeReasons.length > 0) {
    return {
      decision: 'DOWNTREND',
      passed: false,
      reason: severeReasons[0],
      reasons: severeReasons,
      metrics,
    };
  }

  if (extendedReasons.length > 0) {
    return {
      decision: 'EXTENDED',
      passed: false,
      reason: extendedReasons[0],
      reasons: extendedReasons,
      metrics,
    };
  }

  /*
   * SOFT WARNING CONDITIONS
   *
   * These are not enough for immediate rejection.
   * AlphaOS should collect another snapshot.
   */
  if (priceChangePct < -1.5) {
    watchReasons.push(
      `Price softened ${Math.abs(priceChangePct).toFixed(1)}%`,
    );
  }

  if (marketCapChangePct < -1.5) {
    watchReasons.push(
      `Market cap softened ${Math.abs(marketCapChangePct).toFixed(1)}%`,
    );
  }

  if (liquidityChangePct < -4) {
    watchReasons.push(
      `Liquidity weakened ${Math.abs(liquidityChangePct).toFixed(1)}%`,
    );
  }

  if (buyRatioChangePct < -15) {
    watchReasons.push(
      `Buy ratio weakened ${Math.abs(buyRatioChangePct).toFixed(1)}%`,
    );
  }

  if (scoreChange < -2) {
    watchReasons.push(
      `AI score decreased by ${Math.abs(scoreChange).toFixed(0)} points`,
    );
  }

  if (
    sellsAccelerating &&
    sellChangePct > buyChangePct
  ) {
    watchReasons.push(
      'Sell activity is growing faster than buy activity',
    );
  }

  if (
    intervalTransactions >= 8 &&
    intervalBuyRatio < policy.minimumBuyRatio
  ) {
    watchReasons.push(
      `New confirmation flow is weak at ` +
        `${intervalBuyRatio.toFixed(2)} buy ratio`,
    );
  }

  if (watchReasons.length > 0) {
    return {
      decision: 'WATCH',
      passed: false,
      reason: watchReasons[0],
      reasons: watchReasons,
      metrics,
    };
  }

  /*
   * HEALTHY CONFIRMATION
   */
  const healthyReasons: string[] = [];

  if (priceChangePct >= 0) {
    healthyReasons.push('Price held or increased');
  }

  if (marketCapChangePct >= 0) {
    healthyReasons.push('Market cap held or increased');
  }

  if (liquidityChangePct >= -4) {
    healthyReasons.push('Liquidity remained stable');
  }

  if (currentBuyRatio >= policy.minimumBuyRatio) {
    healthyReasons.push(
      `Buy ratio remains healthy at ${currentBuyRatio.toFixed(2)}`,
    );
  }

  if (
    intervalTransactions >= 8 &&
    intervalBuyRatio >= policy.minimumBuyRatio
  ) {
    healthyReasons.push(
      `Confirmation flow is healthy at ` +
        `${intervalBuyRatio.toFixed(2)} buy ratio`,
    );
  }

  /*
  * Do not buy merely because no severe warning occurred.
  * Require at least three pieces of positive evidence.
  */
  if (healthyReasons.length < 3) {
    return {
      decision: 'WATCH',
      passed: false,
      reason:
        'Entry has insufficient positive confirmation',
      reasons: [
        'Fewer than three healthy momentum signals were confirmed',
      ],
      metrics,
    };
  }

  return {
    decision: 'UPTREND',
    passed: true,
    reason: 'Entry momentum confirmed',
    reasons: healthyReasons,
    metrics,
  };
}