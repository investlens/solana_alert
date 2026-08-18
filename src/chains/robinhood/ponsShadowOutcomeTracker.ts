import {
  supabase,
} from '../../services/supabase.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

import {
  scanRobinhoodDevHolding,
} from './security/devHoldingScanner.js';


const TRACKER_INTERVAL_MS =
  1_000;


const MAX_ROWS_PER_CYCLE =
  50;


/*
 * We do not want tiny floating-point
 * fluctuations to look like a dev sell.
 *
 * Example:
 * 4.0000% -> 3.9999%
 *
 * should NOT count as a meaningful
 * developer movement.
 */
const DEV_MOVEMENT_EPSILON_PERCENT =
  0.01;


/*
 * Dev checks do not need to fire for
 * every token on every 1-second cycle.
 *
 * Price is still checked every cycle.
 */
const DEV_CHECK_INTERVAL_MS =
  2_000;


type ShadowRow = {
  id: string;

  token_address: string;

  deployer_address:
    string | null;

  detected_at:
    string;

  would_buy_at:
    string | null;

  entry_price:
    number | null;

  entry_market_cap:
    number | null;

  entry_liquidity:
    number | null;

  dev_holding_percent:
    number | null;

  price_5s:
    number | null;

  roi_5s_percent:
    number | null;

  price_10s:
    number | null;

  roi_10s_percent:
    number | null;

  price_30s:
    number | null;

  roi_30s_percent:
    number | null;

  price_1m:
    number | null;

  roi_1m_percent:
    number | null;

  price_2m:
    number | null;

  roi_2m_percent:
    number | null;

  price_5m:
    number | null;

  roi_5m_percent:
    number | null;

  peak_price:
    number | null;

  peak_roi_percent:
    number | null;

  dev_first_movement_at:
    string | null;

  dev_first_movement_roi_percent:
    number | null;

  tp_100_hit:
    boolean | null;

  tp_200_hit:
    boolean | null;

  tp_500_hit:
    boolean | null;

  tp_1000_hit:
    boolean | null;

  tp_100_hit_at:
    string | null;

  tp_200_hit_at:
    string | null;

  tp_500_hit_at:
    string | null;

  tp_1000_hit_at:
    string | null;

  shadow_status:
    string;

  updated_at:
    string | null;
};


type ShadowUpdate =
  Record<
    string,
    unknown
  >;


let trackerStarted =
  false;


let trackerRunning =
  false;


let trackerInterval:
  | ReturnType<typeof setInterval>
  | null =
  null;


/*
 * Keep the latest dev-scan time in memory
 * so the 1-second price tracker does not
 * hammer the dev scanner every second.
 */
const lastDevCheckAt =
  new Map<
    string,
    number
  >();


function calculateRoi(
  entryPrice:
    number,

  currentPrice:
    number,
): number {
  if (
    !Number.isFinite(
      entryPrice,
    ) ||
    entryPrice <= 0 ||
    !Number.isFinite(
      currentPrice,
    ) ||
    currentPrice <= 0
  ) {
    return 0;
  }


  return (
    (
      currentPrice -
      entryPrice
    ) /
    entryPrice
  ) *
    100;
}


function validNumber(
  value:
    unknown,
): value is number {
  return (
    typeof value ===
      'number' &&
    Number.isFinite(
      value,
    )
  );
}


function shouldCaptureCheckpoint(args: {
  elapsedMs:
    number;

  targetMs:
    number;

  existingPrice:
    number | null;
}): boolean {
  return (
    args.elapsedMs >=
      args.targetMs &&
    args.existingPrice ==
      null
  );
}


function addCheckpointUpdates(args: {
  row:
    ShadowRow;

  elapsedMs:
    number;

  currentPrice:
    number;

  currentRoi:
    number;

  updates:
    ShadowUpdate;
}): void {
  const {
    row,
    elapsedMs,
    currentPrice,
    currentRoi,
    updates,
  } =
    args;


  /*
   * 5 seconds
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        5_000,

      existingPrice:
        row.price_5s,
    })
  ) {
    updates.price_5s =
      currentPrice;

    updates.roi_5s_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 5s checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 10 seconds
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        10_000,

      existingPrice:
        row.price_10s,
    })
  ) {
    updates.price_10s =
      currentPrice;

    updates.roi_10s_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 10s checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 30 seconds
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        30_000,

      existingPrice:
        row.price_30s,
    })
  ) {
    updates.price_30s =
      currentPrice;

    updates.roi_30s_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 30s checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 1 minute
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        60_000,

      existingPrice:
        row.price_1m,
    })
  ) {
    updates.price_1m =
      currentPrice;

    updates.roi_1m_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 1m checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 2 minutes
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        120_000,

      existingPrice:
        row.price_2m,
    })
  ) {
    updates.price_2m =
      currentPrice;

    updates.roi_2m_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 2m checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 5 minutes
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        300_000,

      existingPrice:
        row.price_5m,
    })
  ) {
    updates.price_5m =
      currentPrice;

    updates.roi_5m_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 5m checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }
}


function addPeakUpdates(args: {
  row:
    ShadowRow;

  currentPrice:
    number;

  currentRoi:
    number;

  updates:
    ShadowUpdate;
}): void {
  const existingPeakRoi =
    validNumber(
      args.row
        .peak_roi_percent,
    )
      ? args.row
          .peak_roi_percent
      : 0;


  if (
    args.currentRoi >
    existingPeakRoi
  ) {
    args.updates.peak_roi_percent =
      args.currentRoi;

    args.updates.peak_price =
      args.currentPrice;
  }
}


function addTakeProfitUpdates(args: {
  row:
    ShadowRow;

  currentRoi:
    number;

  nowIso:
    string;

  updates:
    ShadowUpdate;
}): void {
  const {
    row,
    currentRoi,
    nowIso,
    updates,
  } =
    args;


  /*
   * +100% means price is 2X entry.
   */
  if (
    currentRoi >=
      100 &&
    !row.tp_100_hit
  ) {
    updates.tp_100_hit =
      true;

    updates.tp_100_hit_at =
      nowIso;


    console.log(
      '[PonsShadowTracker] 🎯 TP100 HIT:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * +200% means price is 3X entry.
   */
  if (
    currentRoi >=
      200 &&
    !row.tp_200_hit
  ) {
    updates.tp_200_hit =
      true;

    updates.tp_200_hit_at =
      nowIso;


    console.log(
      '[PonsShadowTracker] 🎯 TP200 HIT:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * +500% means price is 6X entry.
   */
  if (
    currentRoi >=
      500 &&
    !row.tp_500_hit
  ) {
    updates.tp_500_hit =
      true;

    updates.tp_500_hit_at =
      nowIso;


    console.log(
      '[PonsShadowTracker] 🚀 TP500 HIT:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * +1000% means price is 11X entry.
   */
  if (
    currentRoi >=
      1000 &&
    !row.tp_1000_hit
  ) {
    updates.tp_1000_hit =
      true;

    updates.tp_1000_hit_at =
      nowIso;


    console.log(
      '[PonsShadowTracker] 🌕 TP1000 HIT:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }
}


async function maybeCheckDevMovement(args: {
  row:
    ShadowRow;

  currentRoi:
    number;

  updates:
    ShadowUpdate;
}): Promise<void> {
  const {
    row,
    currentRoi,
    updates,
  } =
    args;


  /*
   * Once first movement has been captured,
   * we never need to find it again.
   */
  if (
    row.dev_first_movement_at
  ) {
    return;
  }


  const now =
    Date.now();


  const lastCheck =
    lastDevCheckAt.get(
      row.token_address,
    ) ??
    0;


  if (
    now -
      lastCheck <
    DEV_CHECK_INTERVAL_MS
  ) {
    return;
  }


  lastDevCheckAt.set(
    row.token_address,
    now,
  );


  let result:
    Awaited<
      ReturnType<
        typeof scanRobinhoodDevHolding
      >
    >;


  try {
    result =
      await scanRobinhoodDevHolding(
        row.token_address,
      );
  } catch (error) {
    console.log(
      '[PonsShadowTracker] Dev scan failed:',
      {
        token:
          row.token_address,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );


    return;
  }


  const currentDevHolding =
    result.holdingPercent;


  if (
    currentDevHolding ==
    null
  ) {
    return;
  }


  /*
   * If launch-time dev data was unavailable,
   * establish the first successful reading
   * as our Shadow V1 baseline.
   */
  if (
    row.dev_holding_percent ==
    null
  ) {
    updates.dev_holding_percent =
      currentDevHolding;


    console.log(
      '[PonsShadowTracker] Dev baseline established:',
      {
        token:
          row.token_address,

        devHolding:
          currentDevHolding,
      },
    );


    return;
  }


  const reduction =
    row.dev_holding_percent -
    currentDevHolding;


  if (
    reduction <=
    DEV_MOVEMENT_EPSILON_PERCENT
  ) {
    return;
  }


  const nowIso =
    new Date()
      .toISOString();


  updates.dev_first_movement_at =
    nowIso;

  updates.dev_first_movement_roi_percent =
    currentRoi;


  console.log(
    '[PonsShadowTracker] 🚨 DEV MOVEMENT DETECTED:',
    {
      token:
        row.token_address,

      initialDevHolding:
        row.dev_holding_percent,

      currentDevHolding,

      reduction,

      roiAtMovement:
        Number(
          currentRoi.toFixed(
            2,
          ),
        ),
    },
  );
}


async function updateShadowRow(
  row:
    ShadowRow,
): Promise<void> {
  const entryPrice =
    Number(
      row.entry_price,
    );


  if (
    !Number.isFinite(
      entryPrice,
    ) ||
    entryPrice <= 0
  ) {
    /*
     * Dex/indexing data might not have been
     * ready when the launch was first seen.
     *
     * Try to establish an entry reference
     * from the earliest later snapshot.
     */
    let market:
      Awaited<
        ReturnType<
          typeof getRobinhoodMarketSnapshot
        >
      >;


    try {
      market =
        await getRobinhoodMarketSnapshot(
          row.token_address,
        );
    } catch {
      return;
    }


    if (
      !market ||
      !validNumber(
        market.priceUsd,
      ) ||
      market.priceUsd <= 0
    ) {
      return;
    }


    const nowIso =
      new Date()
        .toISOString();


    const {
      error,
    } =
      await supabase
        .from(
          'pons_shadow_trades',
        )
        .update({
          entry_price:
            market.priceUsd,

          entry_market_cap:
            market.marketCapUsd,

          entry_liquidity:
            market.liquidityUsd,

          launch_price:
            market.priceUsd,

          launch_market_cap:
            market.marketCapUsd,

          launch_liquidity:
            market.liquidityUsd,

          peak_price:
            market.priceUsd,

          peak_roi_percent:
            0,

          updated_at:
            nowIso,
        })
        .eq(
          'id',
          row.id,
        );


    if (
      error
    ) {
      console.error(
        '[PonsShadowTracker] Entry reference update failed:',
        {
          token:
            row.token_address,

          error:
            error.message,
        },
      );
    } else {
      console.log(
        '[PonsShadowTracker] Late entry reference established:',
        {
          token:
            row.token_address,

          price:
            market.priceUsd,

          marketCap:
            market.marketCapUsd,
        },
      );
    }


    return;
  }


  const entryTimestamp =
    row.would_buy_at ??
    row.detected_at;


  const entryTime =
    new Date(
      entryTimestamp,
    ).getTime();


  if (
    !Number.isFinite(
      entryTime,
    )
  ) {
    return;
  }


  const elapsedMs =
    Date.now() -
    entryTime;


  let market:
    Awaited<
      ReturnType<
        typeof getRobinhoodMarketSnapshot
      >
    >;


  try {
    market =
      await getRobinhoodMarketSnapshot(
        row.token_address,
      );
  } catch (error) {
    console.log(
      '[PonsShadowTracker] Market snapshot failed:',
      {
        token:
          row.token_address,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );


    return;
  }


  if (
    !market ||
    !validNumber(
      market.priceUsd,
    ) ||
    market.priceUsd <= 0
  ) {
    return;
  }


  const currentPrice =
    market.priceUsd;


  const currentRoi =
    calculateRoi(
      entryPrice,
      currentPrice,
    );


  const nowIso =
    new Date()
      .toISOString();


  const updates:
    ShadowUpdate = {
      updated_at:
        nowIso,
    };


  addPeakUpdates({
    row,

    currentPrice,

    currentRoi,

    updates,
  });


  addCheckpointUpdates({
    row,

    elapsedMs,

    currentPrice,

    currentRoi,

    updates,
  });


  addTakeProfitUpdates({
    row,

    currentRoi,

    nowIso,

    updates,
  });


  await maybeCheckDevMovement({
    row,

    currentRoi,

    updates,
  });


  /*
   * Once 5 minutes have elapsed, record the
   * final checkpoint and mark the experiment
   * complete.
   *
   * The next version can continue monitoring
   * moonbags beyond five minutes.
   */
  if (
    elapsedMs >=
    300_000
  ) {
    updates.shadow_status =
      'COMPLETE';
  }


  const {
    error,
  } =
    await supabase
      .from(
        'pons_shadow_trades',
      )
      .update(
        updates,
      )
      .eq(
        'id',
        row.id,
      );


  if (
    error
  ) {
    console.error(
      '[PonsShadowTracker] Update failed:',
      {
        token:
          row.token_address,

        error:
          error.message,
      },
    );


    return;
  }


  if (
    elapsedMs >=
    300_000
  ) {
    lastDevCheckAt.delete(
      row.token_address,
    );


    console.log(
      '[PonsShadowTracker] ✅ TRACKING COMPLETE:',
      {
        token:
          row.token_address,

        final5mRoi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),

        peakRoi:
          Math.max(
            currentRoi,

            Number(
              row.peak_roi_percent ??
              0,
            ),
          ),

        tp100:
          Boolean(
            row.tp_100_hit ||
            currentRoi >=
              100,
          ),

        tp200:
          Boolean(
            row.tp_200_hit ||
            currentRoi >=
              200,
          ),

        tp500:
          Boolean(
            row.tp_500_hit ||
            currentRoi >=
              500,
          ),

        tp1000:
          Boolean(
            row.tp_1000_hit ||
            currentRoi >=
              1000,
          ),
      },
    );
  }
}


export async function refreshPonsShadowOutcomeTracker():
Promise<void> {
  if (
    trackerRunning
  ) {
    return;
  }


  trackerRunning =
    true;


  try {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          'pons_shadow_trades',
        )
        .select(
          `
            id,
            token_address,
            deployer_address,
            detected_at,
            would_buy_at,
            entry_price,
            entry_market_cap,
            entry_liquidity,
            dev_holding_percent,
            price_5s,
            roi_5s_percent,
            price_10s,
            roi_10s_percent,
            price_30s,
            roi_30s_percent,
            price_1m,
            roi_1m_percent,
            price_2m,
            roi_2m_percent,
            price_5m,
            roi_5m_percent,
            peak_price,
            peak_roi_percent,
            dev_first_movement_at,
            dev_first_movement_roi_percent,
            tp_100_hit,
            tp_200_hit,
            tp_500_hit,
            tp_1000_hit,
            tp_100_hit_at,
            tp_200_hit_at,
            tp_500_hit_at,
            tp_1000_hit_at,
            shadow_status,
            updated_at
          `,
        )
        .eq(
          'shadow_status',
          'TRACKING',
        )
        .order(
          'detected_at',
          {
            ascending:
              true,
          },
        )
        .limit(
          MAX_ROWS_PER_CYCLE,
        );


    if (
      error
    ) {
      console.error(
        '[PonsShadowTracker] Query failed:',
        error.message,
      );


      return;
    }


    const rows =
      (
        data ??
        []
      ) as ShadowRow[];


    if (
      rows.length ===
      0
    ) {
      return;
    }


    /*
     * Keep processing sequential for V1.
     *
     * Because the outer tracker runs once per
     * second, this avoids hammering RPC/Supabase.
     *
     * If launch volume proves high, we'll
     * introduce controlled concurrency.
     */
    for (
      const row
      of rows
    ) {
      try {
        await updateShadowRow(
          row,
        );
      } catch (error) {
        console.error(
          '[PonsShadowTracker] Row failed:',
          {
            token:
              row.token_address,

            error:
              error instanceof Error
                ? error.message
                : String(
                    error,
                  ),
          },
        );
      }
    }
  } catch (error) {
    console.error(
      '[PonsShadowTracker] Cycle failed:',
      error instanceof Error
        ? error.message
        : String(
            error,
          ),
    );
  } finally {
    trackerRunning =
      false;
  }
}


export function startPonsShadowOutcomeTracker():
void {
  if (
    trackerStarted
  ) {
    console.log(
      '[PonsShadowTracker] Already started.',
    );


    return;
  }


  trackerStarted =
    true;


  console.log(
    `[PonsShadowTracker] Started. Interval: ${
      TRACKER_INTERVAL_MS
    }ms.`,
  );


  void refreshPonsShadowOutcomeTracker();


  trackerInterval =
    setInterval(
      () => {
        void refreshPonsShadowOutcomeTracker();
      },

      TRACKER_INTERVAL_MS,
    );
}


export function stopPonsShadowOutcomeTracker():
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


  lastDevCheckAt.clear();


  console.log(
    '[PonsShadowTracker] Stopped.',
  );
}