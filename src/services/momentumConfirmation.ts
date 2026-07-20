import type { RiskResult } from '../types.js';

export type MomentumDecision =
  | 'UPTREND'
  | 'WATCH'
  | 'DOWNTREND';

export interface MomentumCheckResult {
  decision: MomentumDecision;
  passed: boolean;
  reason: string;
  metrics: {
    priceChangePct: number;
    marketCapChangePct: number;
    liquidityChangePct: number;
    previousBuyRatio: number;
    currentBuyRatio: number;
    scoreChange: number;
  };
}

function percentageChange(
  previousValue: number,
  currentValue: number,
): number {
  if (previousValue <= 0 || currentValue <= 0) {
    return 0;
  }

  return (
    ((currentValue - previousValue) / previousValue) *
    100
  );
}

export function confirmMomentum(
  previous: RiskResult,
  current: RiskResult,
): MomentumCheckResult {
  const previousPrice = previous.currentPrice ?? 0;
  const currentPrice = current.currentPrice ?? 0;

  const priceChange = percentageChange(
    previousPrice,
    currentPrice,
  );

  const marketCapChange = percentageChange(
    previous.marketCap,
    current.marketCap,
  );

  const liquidityChange = percentageChange(
    previous.liquidityUsd,
    current.liquidityUsd,
  );

  const previousBuyRatio =
    previous.sells5m <= 0
      ? previous.buys5m
      : previous.buys5m / previous.sells5m;

  const currentBuyRatio =
    current.sells5m <= 0
      ? current.buys5m
      : current.buys5m / current.sells5m;

  const scoreChange =
    current.score - previous.score;

  const metrics = {
    priceChangePct: priceChange,
    marketCapChangePct: marketCapChange,
    liquidityChangePct: liquidityChange,
    previousBuyRatio,
    currentBuyRatio,
    scoreChange,
  };

  if (
    priceChange <= -5 ||
    marketCapChange <= -5 ||
    liquidityChange <= -5 ||
    currentBuyRatio < 1.2 ||
    scoreChange <= -5
  ) {
    return {
      decision: 'DOWNTREND',
      passed: false,
      reason: 'Momentum deteriorated',
      metrics,
    };
  }

  if (
    priceChange < 0 ||
    marketCapChange < 0 ||
    liquidityChange < 0 ||
    currentBuyRatio < previousBuyRatio ||
    scoreChange < 0
  ) {
    return {
      decision: 'WATCH',
      passed: false,
      reason: 'Momentum weakening',
      metrics,
    };
  }

  return {
    decision: 'UPTREND',
    passed: true,
    reason: 'Momentum confirmed',
    metrics,
  };
}