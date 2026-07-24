import { supabase } from '../services/supabase.js';

type TokenMemoryRow = {
  token: string;
  symbol: string | null;
  creator_wallet: string | null;

  alert_market_cap: number | null;
  first_market_cap: number | null;

  alert_liquidity: number | null;
  first_liquidity: number | null;

  buy_count: number | null;
  sell_count: number | null;
  confidence: number | null;

  return_5m_pct: number | null;
  return_1h_pct: number | null;
  return_24h_pct: number | null;
  max_return_pct: number | null;

  final_outcome: string | null;
  outcome: string | null;
  tracking_complete: boolean | null;
};

type BucketStats = {
  label: string;

  sampleSize: number;

  winners: number;
  strongWinners: number;
  failures: number;

  winnerRate: number;
  failureRate: number;

  averageMaxReturn: number;
  medianMaxReturn: number;
  average24hReturn: number;

  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]): number {
  if (!values.length) return 0;

  return (
    values.reduce((total, value) => total + value, 0) /
    values.length
  );
}

function median(values: number[]): number {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (
      sorted[middle - 1] + sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

function confidenceLabel(
  sampleSize: number
): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (sampleSize >= 100) return 'HIGH';
  if (sampleSize >= 30) return 'MEDIUM';

  return 'LOW';
}

function round(value: number, decimals = 2): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function classifyToken(row: TokenMemoryRow) {
  const maxReturn = numberOrNull(row.max_return_pct) ?? 0;
  const return24h = numberOrNull(row.return_24h_pct);
  const return5m = numberOrNull(row.return_5m_pct);

  if (
    maxReturn >= 300 ||
    String(row.final_outcome ?? '').toUpperCase() ===
      'STRONG_WINNER'
  ) {
    return 'STRONG_WINNER';
  }

  if (
    maxReturn >= 100 ||
    String(row.final_outcome ?? '').toUpperCase() === 'WINNER'
  ) {
    return 'WINNER';
  }

  if (
    maxReturn >= 30 ||
    (return24h != null && return24h >= 20)
  ) {
    return 'POSITIVE';
  }

  if (
    maxReturn <= 0 ||
    (return24h != null && return24h <= -50) ||
    (return5m != null && return5m <= -70)
  ) {
    return 'FAILED';
  }

  return 'NEUTRAL';
}

function makeBucketStats(
  label: string,
  rows: TokenMemoryRow[]
): BucketStats {
  const classifications = rows.map(classifyToken);

  const winners = classifications.filter(
    (value) =>
      value === 'WINNER' || value === 'STRONG_WINNER'
  ).length;

  const strongWinners = classifications.filter(
    (value) => value === 'STRONG_WINNER'
  ).length;

  const failures = classifications.filter(
    (value) => value === 'FAILED'
  ).length;

  const maxReturns = rows
    .map((row) => numberOrNull(row.max_return_pct))
    .filter((value): value is number => value !== null);

  const returns24h = rows
    .map((row) => numberOrNull(row.return_24h_pct))
    .filter((value): value is number => value !== null);

  const sampleSize = rows.length;

  return {
    label,
    sampleSize,

    winners,
    strongWinners,
    failures,

    winnerRate:
      sampleSize > 0
        ? round((winners / sampleSize) * 100)
        : 0,

    failureRate:
      sampleSize > 0
        ? round((failures / sampleSize) * 100)
        : 0,

    averageMaxReturn: round(average(maxReturns)),
    medianMaxReturn: round(median(maxReturns)),
    average24hReturn: round(average(returns24h)),

    confidence: confidenceLabel(sampleSize),
  };
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

function buyRatioBucket(
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

function confidenceBucket(value: number | null): string {
  if (value == null) return 'UNKNOWN';
  if (value < 60) return 'UNDER_60';
  if (value < 70) return '60_69';
  if (value < 80) return '70_79';
  if (value < 90) return '80_89';
  return '90_PLUS';
}

function groupRows(
  rows: TokenMemoryRow[],
  getBucket: (row: TokenMemoryRow) => string
) {
  const grouped = new Map<string, TokenMemoryRow[]>();

  for (const row of rows) {
    const bucket = getBucket(row);
    const existing = grouped.get(bucket) ?? [];

    existing.push(row);
    grouped.set(bucket, existing);
  }

  return [...grouped.entries()]
    .map(([label, bucketRows]) =>
      makeBucketStats(label, bucketRows)
    )
    .sort((a, b) => b.winnerRate - a.winnerRate);
}

async function saveLearningMetric(
  metric: string,
  value: unknown,
  sampleSize: number
) {
  const { error } = await supabase.from('ai_learning').upsert(
    {
      metric,
      value,
      sample_size: sampleSize,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'metric',
    }
  );

  if (error) {
    console.log('ai learning save error:', {
      metric,
      error: error.message,
    });
  }
}

function buildCreatorLearning(rows: TokenMemoryRow[]) {
  const grouped = new Map<string, TokenMemoryRow[]>();

  for (const row of rows) {
    if (!row.creator_wallet) continue;

    const existing = grouped.get(row.creator_wallet) ?? [];
    existing.push(row);
    grouped.set(row.creator_wallet, existing);
  }

  return [...grouped.entries()]
    .map(([creatorWallet, creatorRows]) => ({
      creatorWallet,
      ...makeBucketStats(creatorWallet, creatorRows),
      latestToken:
        creatorRows[creatorRows.length - 1]?.token ?? null,
    }))
    .filter((creator) => creator.sampleSize >= 2)
    .sort((a, b) => {
      if (b.winnerRate !== a.winnerRate) {
        return b.winnerRate - a.winnerRate;
      }

      return b.sampleSize - a.sampleSize;
    })
    .slice(0, 100);
}

export async function runOutcomeLearning() {
  console.log('Outcome Learning Agent: starting analysis...');

  const { data, error } = await supabase
    .from('token_memory')
    .select(`
      token,
      symbol,
      creator_wallet,
      alert_market_cap,
      first_market_cap,
      alert_liquidity,
      first_liquidity,
      buy_count,
      sell_count,
      confidence,
      return_5m_pct,
      return_1h_pct,
      return_24h_pct,
      max_return_pct,
      final_outcome,
      outcome,
      tracking_complete
    `)
    .eq('tracking_complete', true)
    .limit(10_000);

  if (error) {
    console.log(
      'Outcome Learning Agent fetch error:',
      error.message
    );
    return;
  }

  const rows = (data ?? []) as TokenMemoryRow[];

  if (!rows.length) {
    console.log(
      'Outcome Learning Agent: no completed outcomes available'
    );
    return;
  }

  const overall = makeBucketStats('ALL_COMPLETED', rows);

  const marketCapLearning = groupRows(rows, (row) =>
    marketCapBucket(
      numberOrNull(row.alert_market_cap) ??
        numberOrNull(row.first_market_cap)
    )
  );

  const liquidityLearning = groupRows(rows, (row) =>
    liquidityBucket(
      numberOrNull(row.alert_liquidity) ??
        numberOrNull(row.first_liquidity)
    )
  );

  const buyRatioLearning = groupRows(rows, (row) =>
    buyRatioBucket(
      numberOrNull(row.buy_count),
      numberOrNull(row.sell_count)
    )
  );

  const confidenceLearning = groupRows(rows, (row) =>
    confidenceBucket(numberOrNull(row.confidence))
  );

  const creatorLearning = buildCreatorLearning(rows);

  await Promise.all([
    saveLearningMetric(
      'overall_performance',
      overall,
      rows.length
    ),

    saveLearningMetric(
      'market_cap_performance',
      marketCapLearning,
      rows.length
    ),

    saveLearningMetric(
      'liquidity_performance',
      liquidityLearning,
      rows.length
    ),

    saveLearningMetric(
      'buy_sell_ratio_performance',
      buyRatioLearning,
      rows.length
    ),

    saveLearningMetric(
      'confidence_score_performance',
      confidenceLearning,
      rows.length
    ),

    saveLearningMetric(
      'creator_performance',
      creatorLearning,
      rows.filter((row) => Boolean(row.creator_wallet)).length
    ),
  ]);

  console.log('Outcome Learning Agent completed:', {
    completedTokens: rows.length,
    overallWinnerRate: overall.winnerRate,
    strongestMarketCapBucket:
      marketCapLearning[0]?.label ?? 'UNKNOWN',
    strongestLiquidityBucket:
      liquidityLearning[0]?.label ?? 'UNKNOWN',
    strongestBuyRatioBucket:
      buyRatioLearning[0]?.label ?? 'UNKNOWN',
    creatorsAnalyzed: creatorLearning.length,
  });
}