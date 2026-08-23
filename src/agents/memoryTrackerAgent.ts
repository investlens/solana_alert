import { supabase } from '../services/supabase.js';
import { enrichTokenByMintAddress } from '../services/dexscreener.js';
import { upsertTokenMemory } from '../memory/tokenMemory.js';
import { recordTokenMemoryEvent } from '../memory/tokenMemoryEvents.js';
import { getCreatorWalletForToken } from '../profiles/tokenCreatorLookup.js';
import { confirmMomentum } from '../services/momentumConfirmation.js';
import { recordOpportunityAndEmit } from '../services/opportunityService.js';
import { transitionActiveStrategyOpportunity } from '../core/opportunityRegistry.js';
import type { RiskResult } from '../types.js';

export type MemoryRow = {
  token: string;
  chain: string | null;
  symbol: string | null;
  last_updated: string | null;

  current_market_cap: number | null;
  current_liquidity: number | null;
  current_price: number | null;

  peak_market_cap: number | null;

  buy_count: number | null;
  sell_count: number | null;

  confidence: number | null;
  raw: Record<string, unknown> | null;
};

const POLL_MS = Number(process.env.MEMORY_TRACKER_POLL_MS ?? 10 * 60 * 1000);
const BATCH_SIZE = Number(process.env.MEMORY_TRACKER_BATCH_SIZE ?? 15);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function classifyOutcome(marketCap: number | null, liquidity: number | null) {
  if (!marketCap || marketCap <= 0) return 'TRACKING';
  if (marketCap >= 1_000_000) return 'MOONSHOT';
  if (marketCap >= 250_000) return 'SUCCESSFUL';
  if (marketCap >= 50_000) return 'ACTIVE';
  if (liquidity != null && liquidity < 1_000) return 'WEAK_LIQUIDITY';
  return 'TRACKING';
}

async function fetchMemoryBatch(): Promise<MemoryRow[]> {
  const { data, error } = await supabase
    .from('token_memory')
    .select(`
      token,
      chain,
      symbol,
      last_updated,
      current_market_cap,
      current_liquidity,
      current_price,
      peak_market_cap,
      buy_count,
      sell_count,
      confidence,
      raw
    `)
    .or('status.is.null,status.eq.TRACKING,status.eq.ACTIVE')
    .order('last_updated', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.log('memory tracker fetch error:', error.message);
    return [];
  }

  return (data ?? []) as MemoryRow[];
}


function getPreviousMemoryScore(
  row: MemoryRow,
  fallback: number,
): number {
  const raw =
    row.raw &&
    typeof row.raw === 'object' &&
    !Array.isArray(row.raw)
      ? row.raw
      : {};

  const latest =
    raw.latest &&
    typeof raw.latest === 'object' &&
    !Array.isArray(raw.latest)
      ? raw.latest as Record<string, unknown>
      : {};

  const score =
    Number(
      latest.score ??
      latest.alphaScore ??
      fallback,
    );

  return Number.isFinite(score)
    ? score
    : fallback;
}

export async function evaluateSolMomentum(
  row: MemoryRow,
  current: RiskResult,
) {
  if (
    (row.chain ?? 'solana').toLowerCase() !==
    'solana'
  ) {
    return;
  }

  const hasPreviousSnapshot =
    Number(row.current_market_cap ?? 0) > 0 &&
    Number(row.current_liquidity ?? 0) > 0 &&
    Number(row.current_price ?? 0) > 0;

  if (!hasPreviousSnapshot) {
    return;
  }

  /*
   * confirmMomentum() only reads a subset of RiskResult
   * from the previous observation.
   *
   * Start from the fresh enriched result so all required
   * RiskResult fields remain valid, then replace the fields
   * representing the previous observation.
   */
  const previous: RiskResult = {
    ...current,

    score:
      getPreviousMemoryScore(
        row,
        current.score,
      ),

    marketCap:
      Number(
        row.current_market_cap ??
        0,
      ),

    liquidityUsd:
      Number(
        row.current_liquidity ??
        0,
      ),

    currentPrice:
      Number(
        row.current_price ??
        0,
      ),

    buys5m:
      Number(
        row.buy_count ??
        0,
      ),

    sells5m:
      Number(
        row.sell_count ??
        0,
      ),
  };

  const momentum =
    confirmMomentum(
      previous,
      current,
    );

  if (
    momentum.decision ===
    'DOWNTREND'
  ) {
    const transitioned =
      await transitionActiveStrategyOpportunity({
        assetId:
          row.token,

        chain:
          'solana',

        strategyKey:
          'SOL_MOMENTUM',

        status:
          'EXPIRED',

        recommendedAction:
          'IGNORE',

        why:
          momentum.reasons.join(' '),

        whatHappened:
          `AlphaOS detected momentum deterioration during continuous re-observation. ${momentum.reason}`,

        invalidation:
          'The previous SOL_MOMENTUM thesis is no longer valid. A future opportunity must qualify again from fresh observations.',

        riskReason:
          'Price, market structure, liquidity, order flow, or AI score weakened enough for AlphaOS to invalidate the active momentum setup.',

        confidence:
          Math.max(
            0,
            Math.min(
              100,
              current.score,
            ),
          ),

        riskScore:
          current.risk === 'HIGH'
            ? 90
            : current.risk === 'MEDIUM'
              ? 70
              : 55,

        rawData: {
          strategy:
            'SOL_MOMENTUM',

          decision:
            momentum.decision,

          reason:
            momentum.reason,

          reasons:
            momentum.reasons,

          metrics:
            momentum.metrics,

          currentScore:
            current.score,

          currentRisk:
            current.risk,
        },
      });

    console.log(
      transitioned
        ? '[SOL_MOMENTUM] Active opportunity invalidated'
        : '[SOL_MOMENTUM] Downtrend detected; no active opportunity to invalidate',
      {
        token:
          row.token,

        symbol:
          row.symbol,

        reason:
          momentum.reason,
      },
    );

    return;
  }

  const recommendedAction =
    momentum.decision === 'UPTREND'
      ? 'CHECK_ENTRY'
      : momentum.decision === 'EXTENDED'
        ? 'TRACK'
        : 'WATCH';

  const confidence =
    momentum.decision === 'UPTREND'
      ? Math.max(
          70,
          Math.min(
            95,
            current.score,
          ),
        )
      : Math.max(
          50,
          Math.min(
            80,
            current.score,
          ),
        );

  const priceChange =
    momentum.metrics.priceChangePct;

  const marketCapChange =
    momentum.metrics.marketCapChangePct;

  const liquidityChange =
    momentum.metrics.liquidityChangePct;

  const buyRatio =
    momentum.metrics.currentBuyRatio;

  const whatHappened =
    [
      `Price ${priceChange >= 0 ? 'moved up' : 'moved down'} ${Math.abs(priceChange).toFixed(1)}%.`,
      `Market cap ${marketCapChange >= 0 ? 'moved up' : 'moved down'} ${Math.abs(marketCapChange).toFixed(1)}%.`,
      liquidityChange > 0
        ? `Liquidity improved ${liquidityChange.toFixed(1)}%.`
        : liquidityChange < 0
          ? `Liquidity weakened ${Math.abs(liquidityChange).toFixed(1)}%.`
          : 'Liquidity held steady.',
      `Current buy ratio is ${buyRatio.toFixed(2)}.`,
    ].join(' ');

  const invalidation =
    'Invalidate the momentum thesis if price or market cap reverses materially, liquidity deteriorates, buy pressure collapses, or AlphaOS classifies a later observation as DOWNTREND.';

  const riskReason =
    momentum.decision === 'EXTENDED'
      ? 'Momentum is strong but the move is already extended. Chasing the current price can create poor entry risk.'
      : momentum.decision === 'WATCH'
        ? `Momentum is not yet strong enough for entry confirmation: ${momentum.reason}`
        : 'Momentum is currently constructive, but fast-moving Solana tokens can reverse quickly and still require manual entry validation.';

  await recordOpportunityAndEmit({
    opportunityType:
      'DEX_CONFIRMATION',

    assetId:
      row.token,

    chain:
      'solana',

    sourceAgent:
      'MemoryTrackerAgent',

    title:
      `Solana Momentum: ${row.symbol ?? row.token}`,

    strategyKey:
      'SOL_MOMENTUM',

    recommendedAction,

    why:
      momentum.reasons.join(' '),

    whatHappened,

    invalidation,

    riskReason,

    entryPrice:
      current.currentPrice,

    exitPrice:
      null,

    expectedProfit:
      null,

    expectedProfitPercent:
      null,

    riskScore:
      current.risk === 'LOW'
        ? 25
        : current.risk === 'MEDIUM'
          ? 50
          : 80,

    confidence,

    status:
      momentum.decision === 'UPTREND'
        ? 'NEW'
        : 'WATCHING',

    lastObservedAt:
      new Date().toISOString(),

    rawData: {
      strategy:
        'SOL_MOMENTUM',

      symbol:
        row.symbol,

      marketCap:
        current.marketCap,

      liquidity:
        current.liquidityUsd,

      decision:
        momentum.decision,

      passed:
        momentum.passed,

      reason:
        momentum.reason,

      reasons:
        momentum.reasons,

      metrics:
        momentum.metrics,

      currentScore:
        current.score,

      currentRisk:
        current.risk,
    },
  });

  console.log(
    '[SOL_MOMENTUM] Opportunity observed:',
    {
      token: row.token,
      symbol: row.symbol,
      decision:
        momentum.decision,
      action:
        recommendedAction,
      confidence,
    },
  );
}


export async function evaluateSolReentry(
  row: MemoryRow,
  current: RiskResult,
) {
  if (
    (row.chain ?? 'solana').toLowerCase() !==
    'solana'
  ) {
    return;
  }

  const previousMarketCap =
    Number(row.current_market_cap ?? 0);

  const previousLiquidity =
    Number(row.current_liquidity ?? 0);

  const previousPrice =
    Number(row.current_price ?? 0);

  const peakMarketCap =
    Number(row.peak_market_cap ?? 0);

  const currentMarketCap =
    Number(current.marketCap ?? 0);

  if (
    previousMarketCap <= 0 ||
    previousLiquidity <= 0 ||
    previousPrice <= 0 ||
    peakMarketCap <= 0 ||
    currentMarketCap <= 0
  ) {
    return;
  }

  /*
   * SOL_REENTRY is intentionally different from SOL_MOMENTUM.
   *
   * A token must first have demonstrated meaningful historical
   * strength, then pulled back from that established peak.
   *
   * Fresh momentum decides whether that pullback is recovering.
   */
  const drawdownFromPeakPct =
    ((currentMarketCap - peakMarketCap) /
      peakMarketCap) *
    100;

  const drawdownDepth =
    Math.abs(drawdownFromPeakPct);

  const meaningfulPullback =
    drawdownFromPeakPct <= -15 &&
    drawdownFromPeakPct >= -60;

  /*
   * Do not turn catastrophic collapses into "re-entry"
   * opportunities. If an active thesis exists, invalidate it.
   */
  const catastrophicDrawdown =
    drawdownFromPeakPct <= -70;

  const previous: RiskResult = {
    ...current,

    score:
      getPreviousMemoryScore(
        row,
        current.score,
      ),

    marketCap:
      previousMarketCap,

    liquidityUsd:
      previousLiquidity,

    currentPrice:
      previousPrice,

    buys5m:
      Number(row.buy_count ?? 0),

    sells5m:
      Number(row.sell_count ?? 0),
  };

  const momentum =
    confirmMomentum(
      previous,
      current,
    );

  const currentLiquidity =
    Number(current.liquidityUsd ?? 0);

  const liquidityViable =
    currentLiquidity >= 6_000;

  const riskAcceptable =
    current.risk === 'LOW' ||
    current.risk === 'MEDIUM';

  /*
   * Existing re-entry thesis failed.
   */
  if (
    catastrophicDrawdown ||
    momentum.decision === 'DOWNTREND' ||
    !liquidityViable ||
    !riskAcceptable
  ) {
    const reasons: string[] = [];

    if (catastrophicDrawdown) {
      reasons.push(
        `Token is ${drawdownDepth.toFixed(1)}% below its historical peak`,
      );
    }

    if (momentum.decision === 'DOWNTREND') {
      reasons.push(
        ...momentum.reasons,
      );
    }

    if (!liquidityViable) {
      reasons.push(
        `Liquidity is only $${Math.round(currentLiquidity).toLocaleString()}`,
      );
    }

    if (!riskAcceptable) {
      reasons.push(
        `Current risk classification is ${current.risk}`,
      );
    }

    const transitioned =
      await transitionActiveStrategyOpportunity({
        assetId:
          row.token,

        chain:
          'solana',

        strategyKey:
          'SOL_REENTRY',

        status:
          'EXPIRED',

        recommendedAction:
          'IGNORE',

        why:
          reasons.join(' '),

        whatHappened:
          'AlphaOS detected deterioration that invalidated the active SOL_REENTRY recovery thesis.',

        invalidation:
          'The previous re-entry thesis is no longer valid. A future re-entry must qualify again from fresh observations.',

        riskReason:
          reasons.join(' '),

        confidence:
          Math.max(
            0,
            Math.min(
              100,
              current.score,
            ),
          ),

        riskScore:
          current.risk === 'HIGH'
            ? 90
            : current.risk === 'MEDIUM'
              ? 70
              : 55,

        rawData: {
          strategy:
            'SOL_REENTRY',

          decision:
            'INVALIDATED',

          peakMarketCap,
          currentMarketCap,
          drawdownFromPeakPct,

          momentumDecision:
            momentum.decision,

          momentumReason:
            momentum.reason,

          momentumMetrics:
            momentum.metrics,

          currentLiquidity,
          currentRisk:
            current.risk,

          currentScore:
            current.score,
        },
      });

    if (transitioned) {
      console.log(
        '[SOL_REENTRY] Active opportunity invalidated',
        {
          token:
            row.token,

          symbol:
            row.symbol,

          drawdownFromPeakPct:
            Number(
              drawdownFromPeakPct.toFixed(2),
            ),

          reason:
            reasons[0] ??
            momentum.reason,
        },
      );
    }

    return;
  }

  /*
   * No meaningful historical pullback = no re-entry setup.
   *
   * This prevents SOL_REENTRY from simply duplicating
   * SOL_MOMENTUM.
   */
  if (!meaningfulPullback) {
    return;
  }

  /*
   * Recovery state:
   *
   * UPTREND  -> entry can be checked
   * WATCH    -> recovery candidate, observe again
   * EXTENDED -> recovery happened too quickly, do not chase
   */
  const recommendedAction =
    momentum.decision === 'UPTREND'
      ? 'CHECK_ENTRY'
      : momentum.decision === 'EXTENDED'
        ? 'TRACK'
        : 'WATCH';

  const confidence =
    momentum.decision === 'UPTREND'
      ? Math.max(
          72,
          Math.min(
            95,
            current.score,
          ),
        )
      : Math.max(
          50,
          Math.min(
            80,
            current.score,
          ),
        );

  const whatHappened =
    [
      `Token previously reached approximately $${Math.round(peakMarketCap).toLocaleString()} market cap.`,
      `It is now ${drawdownDepth.toFixed(1)}% below that peak.`,
      `Current market cap is approximately $${Math.round(currentMarketCap).toLocaleString()}.`,
      `Fresh momentum classification is ${momentum.decision}.`,
      `Current buy ratio is ${momentum.metrics.currentBuyRatio.toFixed(2)}.`,
    ].join(' ');

  const riskReason =
    momentum.decision === 'EXTENDED'
      ? 'The recovery accelerated quickly. AlphaOS will track it rather than chase the rebound.'
      : momentum.decision === 'WATCH'
        ? `The historical pullback qualifies, but recovery confirmation is incomplete: ${momentum.reason}`
        : 'The token has recovered from a meaningful historical pullback with constructive fresh momentum, but re-entry remains higher risk than a clean first-entry setup.';

  await recordOpportunityAndEmit({
    opportunityType:
      'DEX_CONFIRMATION',

    assetId:
      row.token,

    chain:
      'solana',

    sourceAgent:
      'MemoryTrackerAgent',

    title:
      `Solana Re-entry: ${row.symbol ?? row.token}`,

    strategyKey:
      'SOL_REENTRY',

    recommendedAction,

    why:
      [
        `Historical peak approximately $${Math.round(peakMarketCap).toLocaleString()}.`,
        `Current drawdown ${drawdownDepth.toFixed(1)}%.`,
        ...momentum.reasons,
      ].join(' '),

    whatHappened,

    invalidation:
      'Invalidate the re-entry thesis if the drawdown becomes catastrophic, fresh momentum turns down, liquidity falls below the viability floor, or AlphaOS risk becomes HIGH.',

    riskReason,

    entryPrice:
      current.currentPrice,

    exitPrice:
      null,

    expectedProfit:
      null,

    expectedProfitPercent:
      null,

    riskScore:
      current.risk === 'LOW'
        ? 30
        : current.risk === 'MEDIUM'
          ? 55
          : 85,

    confidence,

    status:
      momentum.decision === 'UPTREND'
        ? 'NEW'
        : 'WATCHING',

    lastObservedAt:
      new Date().toISOString(),

    rawData: {
      strategy:
        'SOL_REENTRY',

      symbol:
        row.symbol,

      decision:
        momentum.decision,

      peakMarketCap,
      currentMarketCap,

      currentLiquidity:
        current.liquidityUsd,

      drawdownFromPeakPct,

      liquidityViable,
      riskAcceptable,

      momentumPassed:
        momentum.passed,

      momentumReason:
        momentum.reason,

      momentumReasons:
        momentum.reasons,

      momentumMetrics:
        momentum.metrics,

      currentScore:
        current.score,

      currentRisk:
        current.risk,
    },
  });

  console.log(
    '[SOL_REENTRY] Opportunity observed:',
    {
      token:
        row.token,

      symbol:
        row.symbol,

      peakMarketCap,

      currentMarketCap,

      drawdownFromPeakPct:
        Number(
          drawdownFromPeakPct.toFixed(2),
        ),

      momentum:
        momentum.decision,

      action:
        recommendedAction,

      confidence,
    },
  );
}

async function updateToken(row: MemoryRow) {
  const enriched = await enrichTokenByMintAddress(row.token);
  const pair = enriched?.pair;
  const result = enriched?.result;

  if (!pair || !result) {
    await recordTokenMemoryEvent({
      token: row.token,
      chain: row.chain ?? 'solana',
      eventType: 'CHECK_FAILED',
      eventSource: 'MEMORY_TRACKER',
      note: 'No DexScreener pair/enrichment available during memory update',
    });

    return;
  }

  const marketCap = num(result.marketCap);
  const liquidity = num(result.liquidityUsd);
  const price = num(result.currentPrice);
  const outcome = classifyOutcome(marketCap, liquidity);
  const creatorWallet =
    await getCreatorWalletForToken(row.token);

  /*
   * Evaluate the fresh observation against the PREVIOUS
   * token_memory snapshot before upsertTokenMemory replaces it.
   */
  try {
    await evaluateSolMomentum(
      row,
      result,
    );
  } catch (error) {
    console.warn(
      '[SOL_MOMENTUM] Evaluation failed (ignored):',
      {
        token: row.token,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );
  }

  try {
    await evaluateSolReentry(
      row,
      result,
    );
  } catch (error) {
    console.warn(
      '[SOL_REENTRY] Evaluation failed (ignored):',
      {
        token: row.token,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );
  }

  await upsertTokenMemory({
    token: row.token,
    symbol: pair.baseToken?.symbol ?? row.symbol,
    name: pair.baseToken?.name ?? null,
    chain: row.chain ?? 'solana',
    creatorWallet,
    marketCap,
    liquidity,
    price,
    buys: result.buys5m,
    sells: result.sells5m,
    confidence: result.score,
    riskLevel: result.risk,
    holderScore: result.marketSafetyScore,
    authorityScore: result.authoritySafetyScore,
    raw: {
      source: 'MEMORY_TRACKER',
      outcome,
      dexUrl: pair.url ?? null,
      score: result.score,
      buys5m: result.buys5m,
      sells5m: result.sells5m,
      marketCap: result.marketCap,
      liquidityUsd: result.liquidityUsd,
      currentPrice: result.currentPrice,
    },
  });

  await supabase
    .from('token_memory')
    .update({
      status: outcome,
      outcome,
      last_updated: new Date().toISOString(),
    })
    .eq('token', row.token);

  await recordTokenMemoryEvent({
    token: row.token,
    chain: row.chain ?? 'solana',
    eventType: 'MEMORY_UPDATE',
    eventSource: 'MEMORY_TRACKER',
    marketCap,
    liquidity,
    price,
    buys: result.buys5m,
    sells: result.sells5m,
    alphaScore: result.score,
    aiConfidence: result.score,
    riskLevel: result.risk,
    holderScore: result.marketSafetyScore,
    note: `${pair.baseToken?.symbol ?? row.token} memory updated → ${outcome}`,
    raw: {
      outcome,
      dexUrl: pair.url ?? null,
    },
  });

  console.log('memory tracker updated:', {
    token: row.token,
    symbol: pair.baseToken?.symbol,
    marketCap,
    liquidity,
    outcome,
  });
}

export async function startMemoryTracker() {
  console.log('Starting Alpha Memory tracker...');

  while (true) {
    try {
      const rows = await fetchMemoryBatch();

      if (!rows.length) {
        console.log('memory tracker: no tokens to update');
      }

      for (const row of rows) {
        try {
          await updateToken(row);
          await sleep(1200);
        } catch (error) {
          console.log('memory tracker token error:', {
            token: row.token,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      console.log('memory tracker loop error:', error);
    }

    await sleep(POLL_MS);
  }
}
