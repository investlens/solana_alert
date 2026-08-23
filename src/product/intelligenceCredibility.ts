export const SMART_MONEY_MIN_MEASURED_SAMPLE = 3;
export const SMART_MONEY_ESTABLISHED_SAMPLE = 25;
export const PERFORMANCE_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
export const PERFORMANCE_PRICE_SOURCE_VERSION = 'DEX_BASE_V1';

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function calculateRoi(
  referencePrice: unknown,
  observedPrice: unknown,
): number | null {
  const reference = finitePositive(referencePrice);
  const observed = finitePositive(observedPrice);
  if (reference == null || observed == null) return null;

  const roi = ((observed - reference) / reference) * 100;
  return Number.isFinite(roi) ? roi : null;
}

export function formatPercentage(value: unknown): string {
  if (value == null || value === '') return 'Unavailable';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'Unavailable';
  const digits = Math.abs(parsed) >= 1_000 ? 0 : 1;
  return `${parsed >= 0 ? '+' : ''}${parsed.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function formatRate(value: unknown): string {
  if (value == null || value === '') return 'Unavailable';
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return 'Unavailable';
  return `${parsed.toFixed(1)}%`;
}

export type PerformanceAssessment = {
  peakRoi: number | null;
  currentRoi: number | null;
  stale: boolean;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'SOURCE_REVIEW';
};

export function assessPerformance(args: {
  referencePrice: unknown;
  peakPrice: unknown;
  currentPrice: unknown;
  updatedAt?: unknown;
  now?: number;
  sourceVerified?: boolean;
}): PerformanceAssessment {
  const peakRoi = calculateRoi(args.referencePrice, args.peakPrice);
  const currentRoi = calculateRoi(args.referencePrice, args.currentPrice);
  const updatedAt = Date.parse(String(args.updatedAt ?? ''));
  const stale = !Number.isFinite(updatedAt) ||
    (args.now ?? Date.now()) - updatedAt > PERFORMANCE_STALE_AFTER_MS;

  if (peakRoi == null) {
    return { peakRoi, currentRoi, stale, status: 'UNAVAILABLE' };
  }

  return {
    peakRoi,
    currentRoi,
    stale,
    status: args.sourceVerified ? 'AVAILABLE' : 'SOURCE_REVIEW',
  };
}

export function smartMoneyHistory(completedTrades: unknown) {
  const measured = Math.max(0, Math.floor(Number(completedTrades) || 0));
  const maturity = measured < SMART_MONEY_MIN_MEASURED_SAMPLE
    ? 'INSUFFICIENT DATA'
    : measured < SMART_MONEY_ESTABLISHED_SAMPLE
      ? 'EARLY HISTORY'
      : 'ESTABLISHED HISTORY';
  return { measured, maturity, showWinRate: measured >= SMART_MONEY_MIN_MEASURED_SAMPLE };
}

export function smartMoneySummary(args: {
  completedTrades: unknown;
  totalBuys: unknown;
  winRate: unknown;
}): string {
  const history = smartMoneyHistory(args.completedTrades);
  if (!history.showWinRate) {
    return `${history.measured} measured of ${Math.max(0, Math.floor(Number(args.totalBuys) || 0))} observed · score withheld until 3 measured`;
  }
  return `${history.measured} measured · ${formatRate(args.winRate)} recorded positive rate`;
}

export function creatorHistory(args: {
  totalLaunches: unknown;
  successfulLaunches: unknown;
  failedLaunches: unknown;
}) {
  const observed = Math.max(0, Math.floor(Number(args.totalLaunches) || 0));
  const successful = Math.max(0, Math.floor(Number(args.successfulLaunches) || 0));
  const failed = Math.max(0, Math.floor(Number(args.failedLaunches) || 0));
  const measured = Math.min(observed, successful + failed);
  const measuredSuccessful = Math.min(successful, measured);
  return {
    observed,
    successful: measuredSuccessful,
    failed: Math.min(failed, measured - measuredSuccessful),
    measured,
  };
}

export function creatorSummary(args: {
  totalLaunches: unknown;
  successfulLaunches: unknown;
  failedLaunches: unknown;
}): string[] {
  const history = creatorHistory(args);
  return [
    `${history.observed} launches observed`,
    history.measured === 0
      ? 'Measured outcomes unavailable'
      : `${history.successful}/${history.measured} measured reached the success threshold`,
  ];
}
