import {
  config,
} from '../../config.js';

import {
  supabase,
} from '../../services/supabase.js';

import {
  sendTelegram,
} from '../../services/telegram.js';
import { renderAlphaNotification } from '../../ui/alphaNotification.js';
import { buildAlphaMarketActions } from '../../ui/alphaNotificationActions.js';

import {
  fetchRobinhoodBoosts,
} from './discovery.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

import {
  scanRobinhoodDevHolding,
} from './security/devHoldingScanner.js';

import {
  scanRobinhoodHolderRisk,
} from './security/holderRiskScanner.js';


const BOOST_INTERVAL_MS =
  15_000;


/*
 * Stores the latest totalAmount observed for each
 * boosted token during this process.
 *
 * Supabase is still used as the persistent source
 * of truth across Railway restarts.
 */
const boostTotals =
  new Map<string, number>();

let boostObserverStarted =
  false;

let boostObserverRunning =
  false;

let boostObserverInterval:
  | ReturnType<typeof setInterval>
  | null = null;


function normalize(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase();
}


function formatUsd(
  value: number,
): string {
  if (!Number.isFinite(value)) {
    return '$0';
  }

  if (value >= 1_000_000) {
    return (
      '$' +
      (value / 1_000_000)
        .toFixed(2) +
      'M'
    );
  }

  if (value >= 1_000) {
    return (
      '$' +
      (value / 1_000)
        .toFixed(2) +
      'K'
    );
  }

  return (
    '$' +
    value.toFixed(2)
  );
}


function formatPrice(
  value: number,
): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }

  if (value >= 0.01) {
    return '$' + value.toFixed(6);
  }

  return '$' + value.toPrecision(6);
}


async function getLastStoredBoostTotal(
  tokenAddress: string,
): Promise<number | null> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'robinhood_boost_events',
      )
      .select(
        'total_boost_amount',
      )
      .ilike(
        'token_address',
        tokenAddress,
      )
      .order(
        'detected_at',
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    console.error(
      '[RobinhoodBoostObserver] Boost lookup failed:',
      {
        token:
          tokenAddress,
        error:
          error.message,
      },
    );

    return null;
  }

  if (
    data?.total_boost_amount ==
    null
  ) {
    return null;
  }

  return Number(
    data.total_boost_amount,
  );
}


async function saveBoostEvent(args: {
  tokenAddress: string;

  symbol: string;
  name: string;

  boostAmount: number;
  totalBoostAmount: number;

  price: number;
  marketCap: number;
  liquidity: number;

  volume5m: number;
  buys5m: number;
  sells5m: number;

  devHoldingPercent:
    number | null;

  holderTop1Percent:
    number | null;
}): Promise<string | null> {
  const now =
    new Date().toISOString();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        'robinhood_boost_events',
      )
      .insert({
        token_address:
          args.tokenAddress,

        symbol:
          args.symbol,

        name:
          args.name,

        boost_amount:
          args.boostAmount,

        total_boost_amount:
          args.totalBoostAmount,

        price_at_boost:
          args.price,

        market_cap_at_boost:
          args.marketCap,

        liquidity_at_boost:
          args.liquidity,

        volume_5m_at_boost:
          args.volume5m,

        buys_5m_at_boost:
          args.buys5m,

        sells_5m_at_boost:
          args.sells5m,

        dev_holding_percent:
          args.devHoldingPercent,

        holder_top1_percent:
          args.holderTop1Percent,

        peak_price:
          args.price,

        peak_roi_percent:
          0,

        detected_at:
          now,

        last_checked_at:
          now,
      })
      .select(
        'id',
      )
      .single();

  if (error) {
    console.error(
      '[RobinhoodBoostObserver] Save failed:',
      {
        token:
          args.tokenAddress,

        error:
          error.message,
      },
    );

    return null;
  }

  return (
    data?.id ??
    null
  );
}


export function buildBoostMessage(args: {
  symbol: string;
  tokenAddress: string;

  boostAmount: number;
  totalBoostAmount: number;

  price: number;
  marketCap: number;
  liquidity: number;

  volume5m: number;
  buys5m: number;
  sells5m: number;

  devHoldingPercent:
    number | null;

  holderTop1Percent:
    number | null;

  eventType:
    | 'NEW'
    | 'INCREASE';
}): string {
  const eventLabel =
    args.eventType ===
      'NEW'
      ? 'NEW BOOST'
      : 'BOOST INCREASE';

  const dev =
    args.devHoldingPercent ==
    null
      ? 'Unknown'
      : (
          args.devHoldingPercent
            .toFixed(2) +
          '%'
        );

  const top1 =
    args.holderTop1Percent ==
    null
      ? 'Unknown'
      : (
          args.holderTop1Percent
            .toFixed(2) +
          '%'
        );

  return renderAlphaNotification({
    category: 'market', severity: 'watch', state: 'BUILDING',
    symbol: args.symbol, address: args.tokenAddress, risk: 'REVIEW',
    metrics: [
      { label: 'Event', value: eventLabel },
      { label: 'Boost', value: `+${args.boostAmount} / ${args.totalBoostAmount}` },
      { label: 'Market cap', value: formatUsd(args.marketCap) },
      { label: 'Liquidity', value: formatUsd(args.liquidity) },
      { label: '5m volume', value: formatUsd(args.volume5m) },
      { label: 'Dev holding', value: dev },
    ],
    evidence: [`Top holder ${top1}`, `Buys / sells ${args.buys5m}/${args.sells5m}`],
    reason: 'A new or increased market boost was detected.',
    recommendedAction: 'Monitor for sustained market confirmation.',
  });
}


async function processBoost(
  boost: {
    tokenAddress: string;
    amount: number;
    totalAmount: number;
  },
): Promise<boolean> {
  const tokenKey =
    normalize(
      boost.tokenAddress,
    );

  let previousTotal =
    boostTotals.get(
      tokenKey,
    );

  if (
    previousTotal ==
    null
  ) {
    const storedTotal =
      await getLastStoredBoostTotal(
        boost.tokenAddress,
      );

    if (
      storedTotal !=
      null
    ) {
      previousTotal =
        storedTotal;
    }
  }


  /*
   * Already observed at this total or a
   * higher total. No alert.
   */
  if (
    previousTotal != null &&
    boost.totalAmount <=
      previousTotal
  ) {
    boostTotals.set(
      tokenKey,
      Math.max(
        previousTotal,
        boost.totalAmount,
      ),
    );

    return false;
  }


  const eventType:
    | 'NEW'
    | 'INCREASE' =
    previousTotal == null
      ? 'NEW'
      : 'INCREASE';


  /*
   * For increases, use the actual difference
   * from our previous observation.
   *
   * For a new token, use the current feed
   * amount supplied by DexScreener.
   */
  const boostAdded =
    previousTotal == null
      ? boost.amount
      : Math.max(
          boost.totalAmount -
            previousTotal,
          0,
        );


  const market =
    await getRobinhoodMarketSnapshot(
      boost.tokenAddress,
    );

  if (!market) {
    console.log(
      '[RobinhoodBoostObserver] Waiting for market indexing:',
      boost.tokenAddress,
    );

    return false;
  }


  const [
    devHolding,
    holderRisk,
  ] =
    await Promise.all([
      scanRobinhoodDevHolding(
        boost.tokenAddress,
      ).catch(
        (error) => {
          console.error(
            '[RobinhoodBoostObserver] Dev scan failed:',
            error,
          );

          return null;
        },
      ),

      scanRobinhoodHolderRisk(
        boost.tokenAddress,
      ).catch(
        (error) => {
          console.error(
            '[RobinhoodBoostObserver] Holder scan failed:',
            error,
          );

          return null;
        },
      ),
    ]);


  const devHoldingPercent =
    devHolding?.holdingPercent ??
    null;

  const holderTop1Percent =
    holderRisk?.top1Pct ??
    null;


  const eventId =
    await saveBoostEvent({
      tokenAddress:
        boost.tokenAddress,

      symbol:
        market.symbol,

      name:
        market.name,

      boostAmount:
        boostAdded,

      totalBoostAmount:
        boost.totalAmount,

      price:
        market.priceUsd,

      marketCap:
        market.marketCapUsd,

      liquidity:
        market.liquidityUsd,

      volume5m:
        market.volume5mUsd,

      buys5m:
        market.buys5m,

      sells5m:
        market.sells5m,

      devHoldingPercent,

      holderTop1Percent,
    });


  if (!eventId) {
    return false;
  }


  const message =
    buildBoostMessage({
      symbol:
        market.symbol,

      tokenAddress:
        boost.tokenAddress,

      boostAmount:
        boostAdded,

      totalBoostAmount:
        boost.totalAmount,

      price:
        market.priceUsd,

      marketCap:
        market.marketCapUsd,

      liquidity:
        market.liquidityUsd,

      volume5m:
        market.volume5mUsd,

      buys5m:
        market.buys5m,

      sells5m:
        market.sells5m,

      devHoldingPercent,

      holderTop1Percent,

      eventType,
    });


  await sendTelegram(
    config.adminTelegramId,
    message,
    buildAlphaMarketActions({
      chartUrl: `https://dexscreener.com/robinhood/${boost.tokenAddress}`,
      tokenUrl: `https://robinhoodchain.blockscout.com/token/${boost.tokenAddress}`,
    }),
  );


  boostTotals.set(
    tokenKey,
    boost.totalAmount,
  );


  console.log(
    '[RobinhoodBoostObserver] BOOST ALERT sent:',
    {
      symbol:
        market.symbol,

      token:
        boost.tokenAddress,

      eventType,

      boostAdded,

      totalBoost:
        boost.totalAmount,

      marketCap:
        market.marketCapUsd,
    },
  );


  return true;
}


export async function runRobinhoodBoostObserverCycle():
Promise<void> {
  if (boostObserverRunning) {
    return;
  }

  boostObserverRunning =
    true;

  try {
    const boosts =
      await fetchRobinhoodBoosts();

    console.log(
      '[RobinhoodBoostObserver] Feed:',
      {
        boosts:
          boosts.length,
      },
    );

    let alertsSent =
      0;

    for (
      const boost
      of boosts
    ) {
      try {
        const sent =
          await processBoost(
            boost,
          );

        if (sent) {
          alertsSent += 1;
        }
      } catch (error) {
        console.error(
          '[RobinhoodBoostObserver] Token processing failed:',
          {
            token:
              boost.tokenAddress,

            error,
          },
        );
      }
    }

    console.log(
      '[RobinhoodBoostObserver] Cycle complete:',
      {
        alertsSent,
      },
    );
  } catch (error) {
    console.error(
      '[RobinhoodBoostObserver] Cycle failed:',
      error,
    );
  } finally {
    boostObserverRunning =
      false;
  }
}


export function startRobinhoodBoostObserver():
ReturnType<typeof setInterval> | null {
  if (boostObserverStarted) {
    return (
      boostObserverInterval
    );
  }

  boostObserverStarted =
    true;

  console.log(
    '[RobinhoodBoostObserver] Starting...',
  );

  /*
   * Establish baseline first.
   *
   * Existing boosts are loaded into memory so a
   * Railway restart does not blast Telegram with
   * every currently boosted token.
   */
  void (async () => {
    try {
      const boosts =
        await fetchRobinhoodBoosts();

      for (
        const boost
        of boosts
      ) {
        const storedTotal =
          await getLastStoredBoostTotal(
            boost.tokenAddress,
          );

        boostTotals.set(
          normalize(
            boost.tokenAddress,
          ),
          storedTotal ??
            boost.totalAmount,
        );
      }

      console.log(
        '[RobinhoodBoostObserver] Baseline ready:',
        {
          tokens:
            boosts.length,
        },
      );
    } catch (error) {
      console.error(
        '[RobinhoodBoostObserver] Baseline failed:',
        error,
      );
    }
  })();


  boostObserverInterval =
    setInterval(
      () => {
        void runRobinhoodBoostObserverCycle();
      },
      BOOST_INTERVAL_MS,
    );


  return boostObserverInterval;
}
