import { supabase } from '../services/supabase.js';

type LearningBucket = {
  label: string;
  winners: number;
  failures: number;
  sampleSize: number;

  winnerRate: number;
  failureRate: number;

  strongWinners: number;

  average24hReturn: number;
  averageMaxReturn: number;
  medianMaxReturn: number;

  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
};

type OverallLearning = {
  label: string;
  winners: number;
  failures: number;
  sampleSize: number;

  winnerRate: number;
  failureRate: number;

  strongWinners: number;

  average24hReturn: number;
  averageMaxReturn: number;
  medianMaxReturn: number;

  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
};

type LearningCache = {
  overall: OverallLearning | null;
  marketCap: LearningBucket[];
  liquidity: LearningBucket[];
  buySellRatio: LearningBucket[];
  loadedAt: number;
};

export type AdaptiveLearningInput = {
  marketCap: number | null | undefined;
  liquidity: number | null | undefined;
  buys5m: number | null | undefined;
  sells5m: number | null | undefined;
};

export type LearningReason = {
  metric: string;
  bucket: string;
  adjustment: number;
  sampleSize: number;
  winnerRate: number;
  overallWinnerRate: number;
};

export type AdaptiveLearningResult = {
  totalAdjustment: number;
  reasons: LearningReason[];
  dataAvailable: boolean;
};

export type AIConvictionResult = {
  conviction: number;

  confidence:
    | 'LOW'
    | 'MEDIUM'
    | 'HIGH';

  recommendation:
    | 'IGNORE'
    | 'WATCH'
    | 'GOOD'
    | 'STRONG_BUY';

  reasons: string[];
};

const CACHE_MS = 10 * 60 * 1000;

let cache: LearningCache = {
  overall: null,
  marketCap: [],
  liquidity: [],
  buySellRatio: [],
  loadedAt: 0,
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function marketCapBucket(value: number | null): string {
  if (value == null || value <= 0) return 'UNKNOWN';
  if (value < 20_000) return 'UNDER_20K';
  if (value < 40_000) return '20K_40K';
  if (value < 75_000) return '40K_75K';
  if (value < 100_000) return '75K_100K';
  if (value < 150_000) return '100K_150K';
  if (value < 250_000) return '150K_250K';

  return 'OVER_250K';
}

function liquidityBucket(value: number | null): string {
  if (value == null || value <= 0) return 'UNKNOWN';
  if (value < 3_000) return 'UNDER_3K';
  if (value < 6_000) return '3K_6K';
  if (value < 10_000) return '6K_10K';
  if (value < 20_000) return '10K_20K';
  if (value < 40_000) return '20K_40K';

  return 'OVER_40K';
}

function buySellRatioBucket(
  buys: number | null,
  sells: number | null
): string {
  if (buys == null || sells == null) return 'UNKNOWN';

  const ratio = buys / Math.max(1, sells);

  if (ratio < 1) return 'UNDER_1';
  if (ratio < 1.3) return '1_1.3';
  if (ratio < 1.6) return '1.3_1.6';
  if (ratio < 2) return '1.6_2';
  if (ratio < 3) return '2_3';

  return 'OVER_3';
}

function parseBucketArray(value: unknown): LearningBucket[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const row = item as Record<string, unknown>;

      return {
        label: String(row.label ?? 'UNKNOWN'),

        winners: Number(row.winners ?? 0),
        failures: Number(row.failures ?? 0),
        sampleSize: Number(row.sampleSize ?? 0),

        winnerRate: Number(row.winnerRate ?? 0),
        failureRate: Number(row.failureRate ?? 0),

        strongWinners: Number(row.strongWinners ?? 0),

        average24hReturn: Number(row.average24hReturn ?? 0),
        averageMaxReturn: Number(row.averageMaxReturn ?? 0),
        medianMaxReturn: Number(row.medianMaxReturn ?? 0),

        confidence:
          row.confidence === 'HIGH' ||
          row.confidence === 'MEDIUM'
            ? row.confidence
            : 'LOW',
      } satisfies LearningBucket;
    })
    .filter((item): item is LearningBucket => item !== null);
}

function parseOverall(value: unknown): OverallLearning | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;

  return {
    label: String(row.label ?? 'ALL_COMPLETED'),

    winners: Number(row.winners ?? 0),
    failures: Number(row.failures ?? 0),
    sampleSize: Number(row.sampleSize ?? 0),

    winnerRate: Number(row.winnerRate ?? 0),
    failureRate: Number(row.failureRate ?? 0),

    strongWinners: Number(row.strongWinners ?? 0),

    average24hReturn: Number(row.average24hReturn ?? 0),
    averageMaxReturn: Number(row.averageMaxReturn ?? 0),
    medianMaxReturn: Number(row.medianMaxReturn ?? 0),

    confidence:
      row.confidence === 'HIGH' ||
      row.confidence === 'MEDIUM'
        ? row.confidence
        : 'LOW',
  };
}

async function loadLearningCache() {
  if (
    cache.overall &&
    Date.now() - cache.loadedAt < CACHE_MS
  ) {
    return;
  }

  const { data, error } = await supabase
    .from('ai_learning')
    .select('metric, value');

  if (error) {
    console.log('adaptive learning fetch error:', error.message);
    return;
  }

  const rows = data ?? [];

  const metricValue = (metric: string) =>
    rows.find((row) => row.metric === metric)?.value;

  cache = {
    overall: parseOverall(
      metricValue('overall_performance')
    ),

    marketCap: parseBucketArray(
      metricValue('market_cap_performance')
    ),

    liquidity: parseBucketArray(
      metricValue('liquidity_performance')
    ),

    buySellRatio: parseBucketArray(
      metricValue('buy_sell_ratio_performance')
    ),

    loadedAt: Date.now(),
  };

  console.log('adaptive learning cache loaded:', {
    overallSampleSize: cache.overall?.sampleSize ?? 0,
    marketCapBuckets: cache.marketCap.length,
    liquidityBuckets: cache.liquidity.length,
    buySellRatioBuckets: cache.buySellRatio.length,
  });
}

function findBucket(
  buckets: LearningBucket[],
  label: string
): LearningBucket | null {
  return buckets.find((bucket) => bucket.label === label) ?? null;
}

function calculateBucketAdjustment(args: {
  metric: string;
  bucket: LearningBucket | null;
  overallWinnerRate: number;
  minimumSampleSize: number;
  maximumPositive: number;
  maximumNegative: number;
}): LearningReason | null {
  const {
    metric,
    bucket,
    overallWinnerRate,
    minimumSampleSize,
    maximumPositive,
    maximumNegative,
  } = args;

  if (!bucket) return null;
  if (bucket.sampleSize < minimumSampleSize) return null;

  const performanceDifference =
    bucket.winnerRate - overallWinnerRate;

  /*
   * Approximately one score point for each five percentage
   * points that the bucket performs above or below average.
   */
  const rawAdjustment = Math.round(
    performanceDifference / 5
  );

  const adjustment = clamp(
    rawAdjustment,
    -maximumNegative,
    maximumPositive
  );

  if (adjustment === 0) return null;

  return {
    metric,
    bucket: bucket.label,
    adjustment,
    sampleSize: bucket.sampleSize,
    winnerRate: bucket.winnerRate,
    overallWinnerRate,
  };
}

export async function getAdaptiveLearningAdjustment(
  input: AdaptiveLearningInput
): Promise<AdaptiveLearningResult> {
  await loadLearningCache();

  const overall = cache.overall;

  if (!overall || overall.sampleSize < 50) {
    return {
      totalAdjustment: 0,
      reasons: [],
      dataAvailable: false,
    };
  }

  const overallWinnerRate = overall.winnerRate;
  const reasons: LearningReason[] = [];

  const marketCapLabel = marketCapBucket(
    finiteNumber(input.marketCap)
  );

  const marketCapReason = calculateBucketAdjustment({
    metric: 'MARKET_CAP',
    bucket: findBucket(cache.marketCap, marketCapLabel),
    overallWinnerRate,
    minimumSampleSize: 20,
    maximumPositive: 5,
    maximumNegative: 5,
  });

  if (marketCapReason) {
    reasons.push(marketCapReason);
  }

  const buyRatioLabel = buySellRatioBucket(
    finiteNumber(input.buys5m),
    finiteNumber(input.sells5m)
  );

  const buyRatioReason = calculateBucketAdjustment({
    metric: 'BUY_SELL_RATIO',
    bucket: findBucket(
      cache.buySellRatio,
      buyRatioLabel
    ),
    overallWinnerRate,
    minimumSampleSize: 20,
    maximumPositive: 6,
    maximumNegative: 6,
  });

  if (buyRatioReason) {
    reasons.push(buyRatioReason);
  }

  const liquidityLabel = liquidityBucket(
    finiteNumber(input.liquidity)
  );

  const liquidityReason = calculateBucketAdjustment({
    metric: 'LIQUIDITY',
    bucket: findBucket(
      cache.liquidity,
      liquidityLabel
    ),
    overallWinnerRate,
    minimumSampleSize: 20,
    maximumPositive: 2,
    maximumNegative: 2,
  });

  if (liquidityReason) {
    reasons.push(liquidityReason);
  }

  const rawTotal = reasons.reduce(
    (total, reason) => total + reason.adjustment,
    0
  );

  return {
    totalAdjustment: clamp(rawTotal, -12, 12),
    reasons,
    dataAvailable: true,
  };
}

export function buildAIConviction(
  baseScore: number,
  adaptive: AdaptiveLearningResult
): AIConvictionResult {
  const conviction = clamp(
    baseScore + adaptive.totalAdjustment,
    0,
    100
  );

  let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

  const largestSampleSize = adaptive.reasons.reduce(
    (largest, reason) =>
      Math.max(largest, reason.sampleSize),
    0
  );

  if (
    adaptive.reasons.length >= 3 &&
    largestSampleSize >= 100
  ) {
    confidence = 'HIGH';
  } else if (
    adaptive.reasons.length >= 2 &&
    largestSampleSize >= 30
  ) {
    confidence = 'MEDIUM';
  }

  let recommendation:
    | 'IGNORE'
    | 'WATCH'
    | 'GOOD'
    | 'STRONG_BUY';

  if (conviction >= 85) {
    recommendation = 'STRONG_BUY';
  } else if (conviction >= 75) {
    recommendation = 'GOOD';
  } else if (conviction >= 60) {
    recommendation = 'WATCH';
  } else {
    recommendation = 'IGNORE';
  }

  const reasons = adaptive.reasons.map((reason) => {
    const sign =
      reason.adjustment > 0 ? '+' : '';

    return (
      `${reason.metric} ${reason.bucket}: ` +
      `${sign}${reason.adjustment} ` +
      `(${reason.winnerRate}% win rate, ` +
      `${reason.sampleSize} samples)`
    );
  });

  return {
    conviction,
    confidence,
    recommendation,
    reasons,
  };
}