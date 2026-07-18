import { supabase } from '@/lib/supabase';

type LearningReason = {
  metric?: string;
  bucket?: string;
  adjustment?: number;
  sampleSize?: number;
  winnerRate?: number;
  overallWinnerRate?: number;
};

type AlertSnapshot = {
  source?: string;
  actionBucket?: string;
  baseScore?: number;
  adjustedScore?: number;
  learningAdjustment?: number;
  learningReasons?: LearningReason[];
  creatorWallet?: string | null;
};

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export async function buildAlphaContext(token: string) {
  const { data: memory, error: memoryError } = await supabase
    .from('token_memory')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (memoryError) {
    throw new Error(
      `Alpha Memory lookup failed: ${memoryError.message}`
    );
  }

  if (!memory) {
    return null;
  }

  const raw =
    memory.raw &&
    typeof memory.raw === 'object' &&
    !Array.isArray(memory.raw)
      ? memory.raw
      : {};

  const alert =
    raw.alert &&
    typeof raw.alert === 'object' &&
    !Array.isArray(raw.alert)
      ? (raw.alert as AlertSnapshot)
      : null;

  const creatorWallet =
    memory.creator_wallet ??
    alert?.creatorWallet ??
    null;

  let creator = null;

  if (creatorWallet) {
    const { data, error } = await supabase
      .from('proven_creators')
      .select('*')
      .eq('creator_wallet', creatorWallet)
      .maybeSingle();

    if (!error) {
      creator = data;
    }
  }

  const { data: learningRows } = await supabase
    .from('ai_learning')
    .select('metric, value, sample_size, updated_at')
    .in('metric', [
      'overall_performance',
      'market_cap_performance',
      'liquidity_performance',
      'buy_sell_ratio_performance',
      'confidence_score_performance',
    ]);

  const learning = Object.fromEntries(
    (learningRows ?? []).map((row) => [
      row.metric,
      {
        value: row.value,
        sampleSize: row.sample_size,
        updatedAt: row.updated_at,
      },
    ])
  );

  const baseScore =
    asNumber(alert?.baseScore) ??
    asNumber(memory.confidence);

  const adjustedScore =
    asNumber(alert?.adjustedScore) ??
    asNumber(memory.confidence);

  const learningAdjustment =
    asNumber(alert?.learningAdjustment) ?? 0;

  const buys = asNumber(memory.buy_count) ?? 0;
  const sells = asNumber(memory.sell_count) ?? 0;

  const buySellRatio = buys / Math.max(1, sells);

  return {
    token,

    identity: {
      symbol: memory.symbol,
      name: memory.name,
      chain: memory.chain,
    },

    decision: {
      action:
        alert?.actionBucket ??
        memory.final_outcome ??
        memory.outcome ??
        'MONITOR',

      baseScore,
      adjustedScore,
      learningAdjustment,

      learningReasons:
        alert?.learningReasons ?? [],

      confidence: asNumber(memory.confidence),
      riskLevel: memory.risk_level,
    },

    market: {
      alertMarketCap: asNumber(memory.alert_market_cap),
      currentMarketCap: asNumber(
        memory.current_market_cap
      ),
      peakMarketCap: asNumber(memory.peak_market_cap),

      alertLiquidity: asNumber(memory.alert_liquidity),
      currentLiquidity: asNumber(
        memory.current_liquidity
      ),

      alertPrice: asNumber(memory.alert_price),
      currentPrice: asNumber(memory.current_price),

      buys,
      sells,
      buySellRatio,

      holderScore: asNumber(memory.holder_score),
      authorityScore: asNumber(
        memory.authority_score
      ),
    },

    outcomes: {
      return5m: asNumber(memory.return_5m_pct),
      return15m: asNumber(memory.return_15m_pct),
      return30m: asNumber(memory.return_30m_pct),
      return1h: asNumber(memory.return_1h_pct),
      return6h: asNumber(memory.return_6h_pct),
      return24h: asNumber(memory.return_24h_pct),

      maxReturn: asNumber(memory.max_return_pct),
      outcome: memory.outcome,
      finalOutcome: memory.final_outcome,
      trackingComplete: Boolean(
        memory.tracking_complete
      ),
    },

    creator: creator
      ? {
          wallet: creator.creator_wallet,
          status: creator.status,
          trustScore: asNumber(creator.trust_score),
          totalLaunches: asNumber(
            creator.total_launches
          ),
          trackedLaunches: asNumber(
            creator.tracked_launches
          ),
          winningLaunches: asNumber(
            creator.winning_launches
          ),
          failedLaunches: asNumber(
            creator.failed_launches
          ),
          moonshots: asNumber(creator.moonshots),
          successRate: asNumber(creator.success_rate),
          averageMaxReturn: asNumber(
            creator.average_max_return
          ),
          bestReturn: asNumber(
            creator.best_return_pct
          ),
          bestMarketCap: asNumber(
            creator.best_market_cap
          ),
          summary: creator.reputation_summary,
        }
      : {
          wallet: creatorWallet,
          status: 'UNVERIFIED',
          trustScore: null,
          totalLaunches: null,
          trackedLaunches: null,
          winningLaunches: null,
          failedLaunches: null,
          moonshots: null,
          successRate: null,
          averageMaxReturn: null,
          bestReturn: null,
          bestMarketCap: null,
          summary:
            'Creator outcome history is still being collected.',
        },

    learning,
  };
}