import { supabase } from '../services/supabase.js';
import { enrichTokenByMintAddress } from '../services/dexscreener.js';
import { recordTokenMemoryEvent } from '../memory/tokenMemoryEvents.js';

type CheckpointKey = '5M' | '15M' | '30M' | '1H' | '6H' | '24H';

type MemoryRow = {
  token: string;
  chain: string | null;
  symbol: string | null;

  alert_created_at: string | null;
  first_seen: string | null;

  alert_market_cap: number | null;
  first_market_cap: number | null;

  peak_market_cap: number | null;

  checked_5m_at: string | null;
  checked_15m_at: string | null;
  checked_30m_at: string | null;
  checked_1h_at: string | null;
  checked_6h_at: string | null;
  checked_24h_at: string | null;
};

type CheckpointDefinition = {
  key: CheckpointKey;
  minutes: number;
  checkedColumn:
    | 'checked_5m_at'
    | 'checked_15m_at'
    | 'checked_30m_at'
    | 'checked_1h_at'
    | 'checked_6h_at'
    | 'checked_24h_at';
  marketCapColumn:
    | 'market_cap_5m'
    | 'market_cap_15m'
    | 'market_cap_30m'
    | 'market_cap_1h'
    | 'market_cap_6h'
    | 'market_cap_24h';
  returnColumn:
    | 'return_5m_pct'
    | 'return_15m_pct'
    | 'return_30m_pct'
    | 'return_1h_pct'
    | 'return_6h_pct'
    | 'return_24h_pct';
};

const CHECKPOINTS: CheckpointDefinition[] = [
  {
    key: '5M',
    minutes: 5,
    checkedColumn: 'checked_5m_at',
    marketCapColumn: 'market_cap_5m',
    returnColumn: 'return_5m_pct',
  },
  {
    key: '15M',
    minutes: 15,
    checkedColumn: 'checked_15m_at',
    marketCapColumn: 'market_cap_15m',
    returnColumn: 'return_15m_pct',
  },
  {
    key: '30M',
    minutes: 30,
    checkedColumn: 'checked_30m_at',
    marketCapColumn: 'market_cap_30m',
    returnColumn: 'return_30m_pct',
  },
  {
    key: '1H',
    minutes: 60,
    checkedColumn: 'checked_1h_at',
    marketCapColumn: 'market_cap_1h',
    returnColumn: 'return_1h_pct',
  },
  {
    key: '6H',
    minutes: 360,
    checkedColumn: 'checked_6h_at',
    marketCapColumn: 'market_cap_6h',
    returnColumn: 'return_6h_pct',
  },
  {
    key: '24H',
    minutes: 1440,
    checkedColumn: 'checked_24h_at',
    marketCapColumn: 'market_cap_24h',
    returnColumn: 'return_24h_pct',
  },
];

const POLL_MS = Number(
  process.env.OUTCOME_CHECKPOINT_POLL_MS ?? 60_000
);

const BATCH_SIZE = Number(
  process.env.OUTCOME_CHECKPOINT_BATCH_SIZE ?? 100
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function calculateReturn(
  alertMarketCap: number,
  currentMarketCap: number
) {
  if (alertMarketCap <= 0) return null;

  return ((currentMarketCap - alertMarketCap) / alertMarketCap) * 100;
}

function getNextDueCheckpoint(
  row: MemoryRow
): CheckpointDefinition | null {
  const startedAt = row.alert_created_at ?? row.first_seen;

  if (!startedAt) return null;

  const startedMs = new Date(startedAt).getTime();

  if (!Number.isFinite(startedMs)) return null;

  const elapsedMinutes = (Date.now() - startedMs) / 60_000;

  for (const checkpoint of CHECKPOINTS) {
    if (
      elapsedMinutes >= checkpoint.minutes &&
      !row[checkpoint.checkedColumn]
    ) {
      return checkpoint;
    }
  }

  return null;
}

function classifyInterimOutcome(returnPct: number) {
  if (returnPct >= 200) return 'MOONSHOT';
  if (returnPct >= 100) return 'STRONG_WINNER';
  if (returnPct >= 30) return 'WINNER';
  if (returnPct >= 0) return 'POSITIVE';
  if (returnPct > -20) return 'WEAK';
  if (returnPct > -50) return 'DRAWDOWN';
  return 'FAILED';
}

function classifyFinalOutcome(args: {
  currentReturn: number;
  maxReturn: number;
}) {
  const { currentReturn, maxReturn } = args;

  if (maxReturn >= 300) return 'MOONSHOT';
  if (maxReturn >= 100 && currentReturn >= 25) return 'STRONG_WINNER';
  if (maxReturn >= 50 && currentReturn <= -30) return 'SPIKE_AND_DUMP';
  if (currentReturn >= 25) return 'WINNER';
  if (currentReturn >= 0) return 'POSITIVE';
  if (currentReturn > -20) return 'FLAT';
  if (currentReturn > -50) return 'WEAK';
  return 'FAILED';
}

async function fetchRows(): Promise<MemoryRow[]> {
  const { data, error } = await supabase
    .from('token_memory')
    .select(`
      token,
      chain,
      symbol,
      alert_created_at,
      first_seen,
      alert_market_cap,
      first_market_cap,
      peak_market_cap,
      checked_5m_at,
      checked_15m_at,
      checked_30m_at,
      checked_1h_at,
      checked_6h_at,
      checked_24h_at
    `)
    .eq('tracking_complete', false)
    .order('alert_created_at', {
        ascending: false,
        nullsFirst: false,
        })
        .limit(BATCH_SIZE);

  if (error) {
    console.log('outcome checkpoint fetch error:', error.message);
    return [];
  }

  return (data ?? []) as MemoryRow[];
}

async function processCheckpoint(
  row: MemoryRow,
  checkpoint: CheckpointDefinition
) {
  const alertMarketCap = numberOrNull(
    row.alert_market_cap ?? row.first_market_cap
  );

  if (!alertMarketCap) {
    console.log('checkpoint skipped: missing alert market cap', {
      token: row.token,
      checkpoint: checkpoint.key,
    });

    return;
  }

  const enriched = await enrichTokenByMintAddress(row.token);
  const pair = enriched?.pair;
  const result = enriched?.result;

  if (!pair || !result) {
    await recordTokenMemoryEvent({
      token: row.token,
      chain: row.chain ?? 'solana',
      eventType: `OUTCOME_${checkpoint.key}_FAILED`,
      eventSource: 'OUTCOME_CHECKPOINT',
      note: `Unable to fetch market data at ${checkpoint.key}`,
    });

    return;
  }

  const currentMarketCap = numberOrNull(result.marketCap);
  const currentLiquidity = numberOrNull(result.liquidityUsd);
  const currentPrice = numberOrNull(result.currentPrice);

  if (!currentMarketCap) {
    await recordTokenMemoryEvent({
      token: row.token,
      chain: row.chain ?? 'solana',
      eventType: `OUTCOME_${checkpoint.key}_FAILED`,
      eventSource: 'OUTCOME_CHECKPOINT',
      liquidity: currentLiquidity,
      price: currentPrice,
      note: `Market cap unavailable at ${checkpoint.key}`,
    });

    return;
  }

  const returnPct = calculateReturn(
    alertMarketCap,
    currentMarketCap
  );

  if (returnPct == null) return;

  const previousPeak = numberOrNull(row.peak_market_cap) ?? alertMarketCap;
  const peakMarketCap = Math.max(previousPeak, currentMarketCap);

  const maxReturnPct =
    calculateReturn(alertMarketCap, peakMarketCap) ?? returnPct;

  const drawdownFromPeakPct =
    peakMarketCap > 0
      ? ((currentMarketCap - peakMarketCap) / peakMarketCap) * 100
      : 0;

  const interimOutcome = classifyInterimOutcome(returnPct);

  const finalOutcome =
    checkpoint.key === '24H'
      ? classifyFinalOutcome({
          currentReturn: returnPct,
          maxReturn: maxReturnPct,
        })
      : null;

  const now = new Date().toISOString();

  const updatePayload: Record<string, unknown> = {
    [checkpoint.marketCapColumn]: currentMarketCap,
    [checkpoint.returnColumn]: returnPct,
    [checkpoint.checkedColumn]: now,

    current_market_cap: currentMarketCap,
    current_liquidity: currentLiquidity,
    current_price: currentPrice,

    peak_market_cap: peakMarketCap,
    max_return_pct: maxReturnPct,
    drawdown_from_peak_pct: drawdownFromPeakPct,

    last_checkpoint: checkpoint.key,
    outcome: finalOutcome ?? interimOutcome,
    last_updated: now,
  };

  if (checkpoint.key === '24H') {
    updatePayload.tracking_complete = true;
    updatePayload.final_outcome = finalOutcome;
    updatePayload.status = finalOutcome;
  }

  const { error } = await supabase
    .from('token_memory')
    .update(updatePayload)
    .eq('token', row.token);

  if (error) {
    console.log('outcome checkpoint update error:', {
      token: row.token,
      checkpoint: checkpoint.key,
      error: error.message,
    });

    return;
  }

  await supabase
  .from('creator_launches')
  .update({
    peak_market_cap: peakMarketCap,

    crossed_50k: peakMarketCap >= 50_000,
    crossed_100k: peakMarketCap >= 100_000,
    crossed_250k: peakMarketCap >= 250_000,
    crossed_500k: peakMarketCap >= 500_000,
    crossed_1m: peakMarketCap >= 1_000_000,

    last_updated: now,
  })
  .eq('token', row.token);

  await recordTokenMemoryEvent({
    token: row.token,
    chain: row.chain ?? 'solana',
    eventType: `OUTCOME_${checkpoint.key}`,
    eventSource: 'OUTCOME_CHECKPOINT',

    marketCap: currentMarketCap,
    liquidity: currentLiquidity,
    price: currentPrice,

    buys: result.buys5m,
    sells: result.sells5m,

    alphaScore: result.score,
    aiConfidence: result.score,
    riskLevel: result.risk,

    note:
      `${pair.baseToken?.symbol ?? row.symbol ?? row.token} ` +
      `${checkpoint.key} return ${returnPct.toFixed(1)}% → ` +
      `${finalOutcome ?? interimOutcome}`,

    raw: {
      checkpoint: checkpoint.key,
      alertMarketCap,
      currentMarketCap,
      returnPct,
      peakMarketCap,
      maxReturnPct,
      drawdownFromPeakPct,
      interimOutcome,
      finalOutcome,
    },
  });

  console.log('outcome checkpoint completed:', {
    token: row.token,
    symbol: pair.baseToken?.symbol ?? row.symbol,
    checkpoint: checkpoint.key,
    alertMarketCap,
    currentMarketCap,
    returnPct: Number(returnPct.toFixed(2)),
    maxReturnPct: Number(maxReturnPct.toFixed(2)),
    outcome: finalOutcome ?? interimOutcome,
  });
}

export async function startOutcomeCheckpointAgent() {
  console.log('Starting AlphaOS outcome checkpoint agent...');

  while (true) {
    try {
      const rows = await fetchRows();

      for (const row of rows) {
        const checkpoint = getNextDueCheckpoint(row);

        if (!checkpoint) continue;

        try {
          await processCheckpoint(row, checkpoint);
        } catch (error) {
          console.log('outcome checkpoint token error:', {
            token: row.token,
            checkpoint: checkpoint.key,
            error:
              error instanceof Error
                ? error.message
                : String(error),
          });
        }

        await sleep(700);
      }
    } catch (error) {
      console.log('outcome checkpoint loop error:', error);
    }

    await sleep(POLL_MS);
  }
}