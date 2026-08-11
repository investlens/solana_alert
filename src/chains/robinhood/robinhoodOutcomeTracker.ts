import {
  supabase,
} from '../../services/supabase.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

const TRACKER_INTERVAL_MS =
  60_000;

const MAX_ROWS_PER_CYCLE =
  150;

const FRESH_PRIORITY_WINDOW_MS =
  10 * 60 * 1000;

const CHECKPOINTS = [
  {
    key:
      '1m',

    ageMs:
      1 * 60 * 1000,

    priceColumn:
      'price_1m',

    roiColumn:
      'roi_1m_percent',
    
    marketCapColumn:
      'market_cap_1m',    
  },

  {
    key:
      '2m',

    ageMs:
      2 * 60 * 1000,

    priceColumn:
      'price_2m',

    roiColumn:
      'roi_2m_percent',
    
    marketCapColumn:
     'market_cap_2m',    

  },

  {
    key:
      '3m',

    ageMs:
      3 * 60 * 1000,

    priceColumn:
      'price_3m',

    roiColumn:
      'roi_3m_percent',


    marketCapColumn:
     'market_cap_3m',    

  },

  {
    key:
      '5m',

    ageMs:
      5 * 60 * 1000,

    priceColumn:
      'price_5m',

    roiColumn:
      'roi_5m_percent',


    marketCapColumn:
     'market_cap_5m',    

  },

  {
    key:
      '15m',

    ageMs:
      15 * 60 * 1000,

    priceColumn:
      'price_15m',

    roiColumn:
      'roi_15m_percent',


    marketCapColumn:
     'market_cap_15m',    

  },

  {
    key:
      '30m',

    ageMs:
      30 * 60 * 1000,

    priceColumn:
      'price_30m',

    roiColumn:
      'roi_30m_percent',


    marketCapColumn:
     'market_cap_30m',    

  },

  {
    key:
      '1h',

    ageMs:
      60 * 60 * 1000,

    priceColumn:
      'price_1h',

    roiColumn:
      'roi_1h_percent',


    marketCapColumn:
     'market_cap_1h',    

  },
] as const;

type ObservationRow = {
  id: string;

  token_address: string;

  symbol:
    string | null;

  alerted_at:
    string | null;

  price_at_alert:
    number | null;

  current_price:
    number | null;

  peak_price:
    number | null;

  roi_now_percent:
    number | null;

  roi_high_percent:
    number | null;

  price_1m:
  number | null;

  price_2m:
    number | null;

  price_3m:
    number | null;

  roi_1m_percent:
    number | null;

  roi_2m_percent:
    number | null;

  roi_3m_percent:
    number | null;

  price_5m:
    number | null;

  price_15m:
    number | null;

  price_30m:
    number | null;

  price_1h:
    number | null;

  roi_5m_percent:
    number | null;

  roi_15m_percent:
    number | null;

  roi_30m_percent:
    number | null;

  roi_1h_percent:
    number | null;

  status:
    string | null;

  decision:
  string | null;

  decision_at:
    string | null;

  price_at_decision:
    number | null;

    current_market_cap:
  number | null;

peak_market_cap:
  number | null;

market_cap_1m:
  number | null;

market_cap_2m:
  number | null;

market_cap_3m:
  number | null;

market_cap_5m:
  number | null;

market_cap_15m:
  number | null;

market_cap_30m:
  number | null;

market_cap_1h:
  number | null;

};

let trackerStarted =
  false;

let trackerRunning =
  false;

let trackerInterval:
  | ReturnType<typeof setInterval>
  | null = null;

function calculateRoi(
  entryPrice: number,
  currentPrice: number,
): number {
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(currentPrice) ||
    entryPrice <= 0
  ) {
    return 0;
  }

  return (
    (
      currentPrice -
      entryPrice
    ) /
    entryPrice
  ) * 100;
}

function ageMs(
  alertedAt: string,
): number {
  return (
    Date.now() -
    new Date(
      alertedAt,
    ).getTime()
  );
}

async function loadObservations():
Promise<ObservationRow[]> {
  const freshCutoff =
    new Date(
      Date.now() -
      FRESH_PRIORITY_WINDOW_MS,
    ).toISOString();

  /*
   * Priority 1:
   * Fresh observations.
   *
   * These are the rows where accurate
   * 1m / 2m / 3m checkpoints matter most.
   */
  const {
    data: freshData,
    error: freshError,
  } =
    await supabase
      .from(
        'robinhood_observations',
      )
      .select(`
        id,
        token_address,
        symbol,

        alerted_at,
        decision,
        decision_at,

        price_at_alert,
        price_at_decision,

        current_price,
        peak_price,

        current_market_cap,
        peak_market_cap,

        market_cap_1m,
        market_cap_2m,
        market_cap_3m,
        market_cap_5m,
        market_cap_15m,
        market_cap_30m,
        market_cap_1h,

        roi_now_percent,
        roi_high_percent,

        price_1m,
        price_2m,
        price_3m,
        price_5m,
        price_15m,
        price_30m,
        price_1h,

        roi_1m_percent,
        roi_2m_percent,
        roi_3m_percent,
        roi_5m_percent,
        roi_15m_percent,
        roi_30m_percent,
        roi_1h_percent,

        status
      `)
      .eq(
        'status',
        'WATCHING',
      )
      .gte(
        'decision_at',
        freshCutoff,
      )
      .order(
        'decision_at',
        {
          ascending:
            false,
        },
      )
      .limit(
        MAX_ROWS_PER_CYCLE,
      );

  if (freshError) {
    throw new Error(
      `Could not load fresh Robinhood observations: ${freshError.message}`,
    );
  }

  const freshRows =
    (
      freshData ??
      []
    ) as unknown as ObservationRow[];

  if (
    freshRows.length >=
    MAX_ROWS_PER_CYCLE
  ) {
    return freshRows;
  }


  /*
   * Priority 2:
   * Older rows needing longer-term tracking.
   */
  const remaining =
    MAX_ROWS_PER_CYCLE -
    freshRows.length;

  const {
    data: olderData,
    error: olderError,
  } =
    await supabase
      .from(
        'robinhood_observations',
      )
      .select(`
        id,
        token_address,
        symbol,

        alerted_at,
        decision,
        decision_at,

        price_at_alert,
        price_at_decision,

        current_price,
        peak_price,

        roi_now_percent,
        roi_high_percent,

        price_1m,
        price_2m,
        price_3m,
        price_5m,
        price_15m,
        price_30m,
        price_1h,

        roi_1m_percent,
        roi_2m_percent,
        roi_3m_percent,
        roi_5m_percent,
        roi_15m_percent,
        roi_30m_percent,
        roi_1h_percent,

        status
      `)
      .eq(
        'status',
        'WATCHING',
      )
      .lt(
        'decision_at',
        freshCutoff,
      )
      .order(
        'decision_at',
        {
          ascending:
            false,
        },
      )
      .limit(
        remaining,
      );

  if (olderError) {
    throw new Error(
      `Could not load older Robinhood observations: ${olderError.message}`,
    );
  }

  return [
    ...freshRows,
    ...(
      (
        olderData ??
        []
      ) as unknown as ObservationRow[]
    ),
  ];
}

async function updateObservation(
  row: ObservationRow,
): Promise<void> {
  const baselineTime =
  row.decision_at ??
  row.alerted_at;

const baselinePrice =
  row.price_at_decision ??
  row.price_at_alert;

if (
  !baselineTime ||
  baselinePrice == null ||
  baselinePrice <= 0
) {
  return;
}

  const market =
    await getRobinhoodMarketSnapshot(
      row.token_address,
    );

  if (!market) {
    console.log(
      '[RobinhoodOutcomeTracker] Market unavailable:',
      row.symbol ??
      row.token_address,
    );

    return;
  }

  const currentPrice =
    market.priceUsd;

  const currentMarketCap =
    market.marketCapUsd;

  if (
    !Number.isFinite(
      currentPrice,
    ) ||
    currentPrice <= 0
  ) {
    return;
  }

  if (
  !Number.isFinite(
    currentMarketCap,
  ) ||
  currentMarketCap <= 0
) {
  return;
}

  const currentRoi =
    calculateRoi(
      baselinePrice,
      currentPrice,
    );

  const previousPeak =
    row.peak_price ??
    baselinePrice;

  const peakPrice =
    Math.max(
      previousPeak,
      currentPrice,
    );

  const previousPeakMarketCap =
  row.peak_market_cap ??
  currentMarketCap;

  const peakMarketCap =
    Math.max(
      previousPeakMarketCap,
      currentMarketCap,
    );

  const peakRoi =
    calculateRoi(
      baselinePrice,
      peakPrice,
    );

  const elapsed =
    ageMs(
      baselineTime,
    );

  const update:
  Record<
    string,
    unknown
  > = {
    current_price:
      currentPrice,

    peak_price:
      peakPrice,

    current_market_cap:
      currentMarketCap,

    peak_market_cap:
      peakMarketCap,

    roi_now_percent:
      currentRoi,

    roi_high_percent:
      Math.max(
        row.roi_high_percent ??
        0,
        peakRoi,
      ),

    last_checked_at:
      new Date()
        .toISOString(),

    updated_at:
      new Date()
        .toISOString(),
  };

  for (
  const checkpoint
  of CHECKPOINTS
) {
  const existingPrice =
    row[
      checkpoint
        .priceColumn
    ];

  if (
    elapsed >=
      checkpoint.ageMs &&
    existingPrice == null
  ) {
    update[
      checkpoint
        .priceColumn
    ] =
      currentPrice;

    update[
      checkpoint
        .roiColumn
    ] =
      currentRoi;

    update[
      checkpoint
        .marketCapColumn
    ] =
      currentMarketCap;

    console.log(
  '[RobinhoodOutcomeTracker] Checkpoint captured:',
  {
    symbol:
      row.symbol,

    checkpoint:
      checkpoint.key,

    price:
      currentPrice,

    marketCap:
      currentMarketCap,

    roi:
      Number(
        currentRoi.toFixed(
          2,
        ),
      ),
  },
);

    /*
     * Only one checkpoint per row per cycle.
     *
     * Prevents old rows from receiving
     * identical 1m/2m/3m/5m snapshots.
     */
    break;
  }
}

  /*
   * First production observation rule:
   *
   * after 24 hours, stop treating the row as
   * actively watching. We retain all data for
   * later learning.
   */
  if (
    elapsed >=
    24 *
      60 *
      60 *
      1000
  ) {
    update.status =
      'COMPLETED';
  }

  const {
    error,
  } =
    await supabase
      .from(
        'robinhood_observations',
      )
      .update(
        update,
      )
      .eq(
        'id',
        row.id,
      );

  if (error) {
    console.error(
      '[RobinhoodOutcomeTracker] Update failed:',
      {
        token:
          row.token_address,

        error:
          error.message,
      },
    );

    return;
  }

  console.log(
    '[RobinhoodOutcomeTracker]',
    row.symbol ??
      row.token_address,
    '| ROI',
    `${currentRoi.toFixed(2)}%`,
    '| Peak ROI',
    `${peakRoi.toFixed(2)}%`,
    '| MC',
    `$${Math.round(currentMarketCap)}`,
    '| Peak MC',
    `$${Math.round(peakMarketCap)}`,
  );
}

export async function refreshRobinhoodOutcomeTracker():
  Promise<void> {
  if (trackerRunning) {
    console.log(
      '[RobinhoodOutcomeTracker] Previous cycle still running. Skipping.',
    );

    return;
  }

  trackerRunning =
    true;

  try {
    const observations =
      await loadObservations();

    if (
      observations.length ===
      0
    ) {
      return;
    }

    console.log(
      '[RobinhoodOutcomeTracker] Tracking:',
      observations.length,
      'observation(s)',
    );

    for (
      const observation
      of observations
    ) {
      try {
        await updateObservation(
          observation,
        );
      } catch (error) {
        console.error(
          '[RobinhoodOutcomeTracker] Observation failed:',
          {
            token:
              observation
                .token_address,

            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
        );
      }
    }
  } catch (error) {
    console.error(
      '[RobinhoodOutcomeTracker] Cycle failed:',
      error,
    );
  } finally {
    trackerRunning =
      false;
  }
}

export function startRobinhoodOutcomeTracker():
  void {
  if (trackerStarted) {
    return;
  }

  trackerStarted =
    true;

  console.log(
    `[RobinhoodOutcomeTracker] Started. Interval: ${
      TRACKER_INTERVAL_MS /
      1000
    } seconds.`,
  );

  void refreshRobinhoodOutcomeTracker();

  trackerInterval =
    setInterval(
      () => {
        void refreshRobinhoodOutcomeTracker();
      },
      TRACKER_INTERVAL_MS,
    );
}

export function stopRobinhoodOutcomeTracker():
  void {
  if (
    trackerInterval
  ) {
    clearInterval(
      trackerInterval,
    );

    trackerInterval =
      null;
  }

  trackerStarted =
    false;

  console.log(
    '[RobinhoodOutcomeTracker] Stopped.',
  );
}
