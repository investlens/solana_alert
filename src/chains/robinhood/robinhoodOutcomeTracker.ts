import {
  supabase,
} from '../../services/supabase.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

import {
  config,
} from '../../config.js';

import {
  sendTelegram,
} from '../../services/telegram.js';
import { renderAlphaNotification } from '../../ui/alphaNotification.js';
import { buildAlphaMarketActions } from '../../ui/alphaNotificationActions.js';
import { coreDecisionEvidenceMetrics, marketContextMetrics, normalizeCoreDecisionMetrics, normalizeNotificationMarketContext } from '../../ui/notificationMarketContext.js';

import {
  scanRobinhoodSellability,
} from './security/sellabilityScanner.js';

import {
  scanRobinhoodHolderRisk,
} from './security/holderRiskScanner.js';

import {
  scanRobinhoodDevHolding,
} from './security/devHoldingScanner.js';

import {
  scanRobinhoodDevMovement,
} from './security/devMovementScanner.js';

const TRACKER_INTERVAL_MS =
  60_000;

const MAX_ROWS_PER_CYCLE =
  20;

const FRESH_PRIORITY_WINDOW_MS =
  10 * 60 * 1000;

const MICRO_BREAKOUT_ROI_PERCENT =
  40;

const MICRO_BREAKOUT_MAX_AGE_MS =
  6 * 60 * 1000;

const MICRO_MAX_INITIAL_MARKET_CAP_USD =
  5_000;

const MICRO_MAX_INITIAL_LIQUIDITY_USD =
  5_000;

const MICRO_MAX_SELL_IMPACT_PERCENT =
  0.20;

const MICRO_MAX_TOP1_PERCENT =
  10;

const MICRO_MAX_DEV_HOLDING_PERCENT =
  10;

const MICRO_DEV_CONFIRMATION_DELAY_MS =
  10_000;

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

  pool_fee:
    number | null;

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

  source:
    string | null;

  pair_address:
    string | null;

  market_cap_at_alert:
    number | null;

  liquidity_at_alert:
    number | null;

  sell_impact_percent:
    number | null;

  holder_top1_percent:
    number | null;

  dev_holding_percent:
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
        source,
        pair_address,
        pool_fee,

        alerted_at,
        decision,
        decision_at,

        price_at_alert,
        price_at_decision,
        market_cap_at_alert,
        liquidity_at_alert,
        sell_impact_percent,
        holder_top1_percent,
        dev_holding_percent,

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

function sleep(
  ms: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms,
      );
    },
  );
}


function isCleanMicroCandidate(
  row: ObservationRow,
): boolean {
  if (
    row.decision !==
    'TRACK_ONLY'
  ) {
    return false;
  }

  if (
    row.source !== 'PONS' &&
    row.source !== 'ONCHAIN'
  ) {
    return false;
  }

  const marketCap =
    Number(
      row.market_cap_at_alert ??
      0,
    );

  const liquidity =
    Number(
      row.liquidity_at_alert ??
      0,
    );

  const sellImpact =
    Number(
      row.sell_impact_percent ??
      999,
    );

  if (
  row.holder_top1_percent == null
) {
  return false;
}


const top1 =
  Number(
    row.holder_top1_percent,
  );


const devHolding =
  row.dev_holding_percent == null
    ? null
    : Number(
        row.dev_holding_percent,
      );

  return (
    marketCap > 0 &&
    marketCap <
      MICRO_MAX_INITIAL_MARKET_CAP_USD &&

    liquidity > 0 &&
    liquidity <
      MICRO_MAX_INITIAL_LIQUIDITY_USD &&

    sellImpact <=
      MICRO_MAX_SELL_IMPACT_PERCENT &&

    top1 <=
      MICRO_MAX_TOP1_PERCENT &&

    (
      devHolding == null ||
      devHolding <=
        MICRO_MAX_DEV_HOLDING_PERCENT
    )
  );
}


function getMicroBreakoutLabel(
  elapsed: number,
): string {
  if (
    elapsed <=
    90 * 1000
  ) {
    return 'FAST • ~1M';
  }

  if (
    elapsed <=
    150 * 1000
  ) {
    return 'BREAKOUT • ~2M';
  }

  if (
    elapsed <=
    210 * 1000
  ) {
    return 'BREAKOUT • ~3M';
  }

  return 'BREAKOUT • ~5M';
}

function escapeHtml(
  value: string,
): string {
  return value
    .replace(
      /&/g,
      '&amp;',
    )
    .replace(
      /</g,
      '&lt;',
    )
    .replace(
      />/g,
      '&gt;',
    );
}


export function buildMicroBreakoutMessage(args: {
  row: ObservationRow;

  currentRoi: number;

  currentPrice: number;

  currentMarketCap: number;

  currentLiquidity: number;

  elapsed: number;

  sellImpact:
    number | null;

  top1:
    number | null;

  devHolding:
    number | null;
}): string {
  const symbol =
  escapeHtml(
    args.row.symbol ??
    'UNKNOWN',
  );

  const ageSeconds =
    Math.round(
      args.elapsed /
      1000,
    );

  const market = normalizeNotificationMarketContext({
    marketCap: args.currentMarketCap,
    liquidity: args.currentLiquidity,
  });
  const decisionEvidence = normalizeCoreDecisionMetrics({
    devHoldingPercent: args.devHolding,
    devHoldingEvidence: args.devHolding == null ? 'UNAVAILABLE' : 'VERIFIED',
  });
  return renderAlphaNotification({
    category: 'market', severity: 'positive', state: 'ENTRY_READY',
    symbol, address: args.row.token_address, age: `${ageSeconds}s`, risk: 'REVIEW',
    metrics: [
      { label: 'Momentum', value: `+${args.currentRoi.toFixed(2)}%` },
      ...marketContextMetrics(market),
      { label: 'Exit impact', value: args.sellImpact == null ? 'Data unavailable' : `${args.sellImpact.toFixed(3)}%` },
      { label: 'Top holder', value: args.top1 == null ? 'Data unavailable' : `${args.top1.toFixed(2)}%` },
    ],
    specialistMetrics: coreDecisionEvidenceMetrics(decisionEvidence),
    reason: `A clean early launch reached ${getMicroBreakoutLabel(args.elapsed)} momentum.`,
    recommendedAction: 'Review live conditions before acting.',
    access: 'ADMIN',
  });
}

async function maybeSendMicroBreakout(args: {
  row: ObservationRow;

  currentRoi: number;

  currentPrice: number;

  currentMarketCap: number;

  currentLiquidity: number;

  elapsed: number;
}): Promise<boolean> {
  const {
    row,
    currentRoi,
    currentPrice,
    currentMarketCap,
    currentLiquidity,
    elapsed,
  } = args;


  if (
    !isCleanMicroCandidate(
      row,
    )
  ) {
    return false;
  }


  if (
    elapsed >
    MICRO_BREAKOUT_MAX_AGE_MS
  ) {
    return false;
  }


  if (
    currentRoi <
    MICRO_BREAKOUT_ROI_PERCENT
  ) {
    return false;
  }


  console.log(
    '[RobinhoodMicroBreakout] Trigger detected:',
    {
      symbol:
        row.symbol,

      token:
        row.token_address,

      roi:
        Number(
          currentRoi.toFixed(
            2,
          ),
        ),

      elapsedSeconds:
        Math.round(
          elapsed /
          1000,
        ),
    },
  );


  /*
   * LIVE SAFETY RECHECK
   */

  const [
    sellability,
    holderRisk,
    devHolding,
  ] =
    await Promise.all([
      scanRobinhoodSellability({
        tokenAddress:
          row.token_address,

        source:
          row.source,

        poolFee:
          row.pool_fee,
      }),

      scanRobinhoodHolderRisk(
        row.token_address,
        {
          poolAddress:
            row.pair_address ??
            undefined,
        },
      ),

      scanRobinhoodDevHolding(
        row.token_address,
      ),
    ]);


  if (
    !sellability.sellable ||
    sellability.status ===
      'NO_QUOTE' ||
    sellability.status ===
      'UNSUPPORTED' ||
    sellability.status ===
      'ERROR'
  ) {
    console.log(
      '[RobinhoodMicroBreakout] Blocked - sellability:',
      {
        token:
          row.token_address,

        status:
          sellability.status,
      },
    );

    return false;
  }


  if (
    sellability
      .estimatedImpactPercent !=
      null &&
    sellability
      .estimatedImpactPercent >
      MICRO_MAX_SELL_IMPACT_PERCENT
  ) {
    console.log(
      '[RobinhoodMicroBreakout] Blocked - exit impact:',
      {
        token:
          row.token_address,

        impact:
          sellability
            .estimatedImpactPercent,
      },
    );

    return false;
  }


  if (
    holderRisk.top1Pct !=
      null &&
    holderRisk.top1Pct >
      MICRO_MAX_TOP1_PERCENT
  ) {
    console.log(
      '[RobinhoodMicroBreakout] Blocked - top holder:',
      {
        token:
          row.token_address,

        top1:
          holderRisk.top1Pct,
      },
    );

    return false;
  }


  if (
  devHolding.holdingPercent ==
  null
) {
  console.log(
    '[RobinhoodMicroBreakout] Blocked - dev holding unavailable:',
    row.token_address,
  );

  return false;
}


if (
  devHolding.holdingPercent >
  MICRO_MAX_DEV_HOLDING_PERCENT
) {
  console.log(
    '[RobinhoodMicroBreakout] Blocked - dev holding:',
    {
      token:
        row.token_address,

      devHolding:
        devHolding
          .holdingPercent,
    },
  );

  return false;
}


  /*
   * FINAL DEV MOVEMENT CONFIRMATION
   */

  const devBefore =
    await scanRobinhoodDevMovement(
      row.token_address,
    );


  if (
    devBefore.moved
  ) {
    console.log(
      '[RobinhoodMicroBreakout] Blocked - dev already moved:',
      row.token_address,
    );

    return false;
  }


  await sleep(
    MICRO_DEV_CONFIRMATION_DELAY_MS,
  );


  const devAfter =
    await scanRobinhoodDevMovement(
      row.token_address,
    );


  if (
    devAfter.moved
  ) {
    console.log(
      '[RobinhoodMicroBreakout] Blocked - dev moved during confirmation:',
      row.token_address,
    );

    return false;
  }


  const message =
    buildMicroBreakoutMessage({
      row,

      currentRoi,

      currentPrice,

      currentMarketCap,

      currentLiquidity,

      elapsed,

      sellImpact:
        sellability
          .estimatedImpactPercent,

      top1:
        holderRisk.top1Pct,

      devHolding:
        devHolding.holdingPercent,
    });


  /*
   * Save first.
   *
   * This changes TRACK_ONLY → WATCH,
   * preventing another MICRO alert on
   * later tracker cycles.
   */


  const now =
  new Date()
    .toISOString();


const {
  data:
    promotedRow,

  error:
    promoteError,
} =
  await supabase
    .from(
      'robinhood_observations',
    )
    .update({
      decision:
        'WATCH',

      alerted_at:
        now,

      updated_at:
        now,
    })
    .eq(
      'id',
      row.id,
    )
    .eq(
      'decision',
      'TRACK_ONLY',
    )
    .select(
      'id',
    )
    .maybeSingle();


if (
  promoteError
) {
  console.error(
    '[RobinhoodMicroBreakout] Promotion failed:',
    {
      token:
        row.token_address,

      error:
        promoteError.message,
    },
  );

  return false;
}


if (
  !promotedRow
) {
  console.log(
    '[RobinhoodMicroBreakout] Already claimed by another cycle:',
    row.token_address,
  );

  return false;
}


  await sendTelegram(
    config.adminTelegramId,
    message,
    buildAlphaMarketActions({
      chartUrl: `https://dexscreener.com/robinhood/${row.token_address}`,
      tokenUrl: `https://robinhoodchain.blockscout.com/token/${row.token_address}`,
    }),
  );


  console.log(
    '[RobinhoodMicroBreakout] ALERT SENT:',
    {
      symbol:
        row.symbol,

      token:
        row.token_address,

      roi:
        Number(
          currentRoi.toFixed(
            2,
          ),
        ),

      trigger:
        getMicroBreakoutLabel(
          elapsed,
        ),
    },
  );


  return true;
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

  await maybeSendMicroBreakout({
  row,

  currentRoi,

  currentPrice,

  currentMarketCap,

  currentLiquidity:
    market.liquidityUsd,

  elapsed,
});

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
