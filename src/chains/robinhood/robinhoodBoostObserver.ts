import {
  config,
} from '../../config.js';

import {
  supabase,
} from '../../services/supabase.js';

import {
  sendTelegram,
} from '../../services/telegram.js';
import { buildAlphaMarketActions } from '../../ui/alphaNotificationActions.js';
import {
  normalizeCoreDecisionMetrics,
  normalizeNotificationMarketContext,
  type NotificationMarketContext,
} from '../../ui/notificationMarketContext.js';

import {
  fetchRobinhoodBoosts,
} from './discovery.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

import { scanRobinhoodDevTokenFlow } from './security/devTokenFlowScanner.js';
import { persistAlphaSemanticEvent } from '../../services/alphaSemanticEventService.js';
import { buildPremiumTokenNotification } from '../../ui/premiumTokenNotification.js';

import {
  scanRobinhoodHolderRisk,
} from './security/holderRiskScanner.js';


const BOOST_INTERVAL_MS =
  15_000;

export const BOOSTED_OPPORTUNITY_THRESHOLD = 200;
export const MAJOR_BOOST_THRESHOLD = 500;

export function boostNotificationState(totalBoostAmount: number) {
  return totalBoostAmount >= BOOSTED_OPPORTUNITY_THRESHOLD
    ? 'BOOSTED_OPPORTUNITY' as const
    : 'BUILDING' as const;
}

export function boostPresentationState(totalBoostAmount: number) {
  return totalBoostAmount >= MAJOR_BOOST_THRESHOLD ? 'MAJOR_BOOST' as const : 'BOOST' as const;
}


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

async function getPreviousBoostMarket(tokenAddress: string): Promise<{ price: number; volume5m: number } | null> {
  const { data, error } = await supabase.from('robinhood_boost_events')
    .select('price_at_boost,volume_5m_at_boost').ilike('token_address', tokenAddress)
    .order('detected_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  const price = Number(data?.price_at_boost); const volume5m = Number(data?.volume_5m_at_boost);
  return Number.isFinite(price) && price > 0 && Number.isFinite(volume5m) && volume5m > 0 ? { price, volume5m } : null;
}

export function isMaterialVolumeSurge(args: { previousVolume5m: number | null; currentVolume5m: number | null; previousPrice: number | null; currentPrice: number | null }) {
  return args.previousVolume5m != null && args.previousVolume5m > 0 && args.currentVolume5m != null &&
    args.currentVolume5m >= args.previousVolume5m * 1.5 && args.previousPrice != null && args.previousPrice > 0 &&
    args.currentPrice != null && args.currentPrice >= args.previousPrice * 0.5;
}

export function volumeIgnitionDecision(args: {
  previousVolume5m: number | null; currentVolume5m: number | null;
  previousPrice: number | null; currentPrice: number | null;
  previousLiquidity?: number | null; currentLiquidity?: number | null;
  buys5m?: number | null; sells5m?: number | null;
}) {
  const multiple = args.previousVolume5m != null && args.previousVolume5m > 0 && args.currentVolume5m != null
    ? args.currentVolume5m / args.previousVolume5m : null;
  const priceConstructive = args.previousPrice != null && args.previousPrice > 0 && args.currentPrice != null &&
    args.currentPrice >= args.previousPrice * 0.5;
  const liquidityStable = args.previousLiquidity == null || args.currentLiquidity == null || args.previousLiquidity <= 0 ||
    args.currentLiquidity >= args.previousLiquidity * 0.85;
  const flowConstructive = args.buys5m == null || args.sells5m == null || args.buys5m >= args.sells5m;
  return { eligible: multiple != null && multiple >= 1.5 && priceConstructive && liquidityStable && flowConstructive,
    volumeMultiple: multiple };
}

type BoostOpportunityContext = {
  id: number;
  strategyKey: string | null;
  confidence: number | null;
  risk: string | null;
  rawData: Record<string, unknown>;
};

async function getBoostOpportunityContext(tokenAddress: string): Promise<BoostOpportunityContext | null> {
  const { data, error } = await supabase
    .from('opportunities')
    .select('id,strategy_key,confidence,risk_score,raw_data')
    .eq('asset_id', tokenAddress)
    .eq('chain', 'robinhood')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[RobinhoodBoostObserver] Opportunity context unavailable:', {
      token: tokenAddress,
      error: error.message,
    });
    return null;
  }
  if (!data) return null;
  const riskScore = Number(data.risk_score);
  return {
    id: Number(data.id),
    strategyKey: data.strategy_key ?? null,
    confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null,
    risk: !Number.isFinite(riskScore) ? null : riskScore >= 80 ? 'HIGH' : riskScore >= 55 ? 'MEDIUM' : 'LOW',
    rawData: (data.raw_data as Record<string, unknown> | null) ?? {},
  };
}

function contextNumber(context: Record<string, unknown>, key: string): number | null {
  if (context[key] == null || context[key] === '') return null;
  const value = Number(context[key]);
  return Number.isFinite(value) ? value : null;
}

function contextAge(context: Record<string, unknown>): string | null {
  const seconds = contextNumber(context, 'elapsedSec');
  if (seconds == null || seconds < 0) return null;
  return seconds < 60 ? `${Math.round(seconds)}s` : `${Math.round(seconds / 60)}m`;
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
  name?: string | null;
  tokenAddress: string;

  boostAmount: number;
  totalBoostAmount: number;

  price?: number | null;
  marketCap?: number | null;
  fdv?: number | null;
  liquidity?: number | null;

  volume5m?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
  age?: string | null;
  move?: number | null;
  momentum?: number | null;
  confidence?: number | null;
  risk?: string | null;
  rawData?: Record<string, unknown> | null;
  marketContext?: Partial<NotificationMarketContext> | null;

  devHoldingPercent:
    number | null;

  burnedPercent?:
    number | null;

  holderTop1Percent:
    number | null;

  eventType:
    | 'NEW'
    | 'INCREASE';
}): string {
  const market = normalizeNotificationMarketContext(
    args.marketContext as Record<string, unknown> | null,
    args.rawData,
    { marketCap: args.marketCap, fdv: args.fdv, liquidity: args.liquidity,
      volume5m: args.volume5m, address: args.tokenAddress },
  );
  const decisionEvidence = normalizeCoreDecisionMetrics({
    devHoldingPercent: args.devHoldingPercent,
    devHoldingEvidence: args.devHoldingPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
    burnedPercent: args.burnedPercent,
    burnEvidence: args.burnedPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
  });
  return buildPremiumTokenNotification({
    state: boostPresentationState(args.totalBoostAmount),
    symbol: args.symbol, name: args.name, address: args.tokenAddress, age: args.age,
    market, evidence: decisionEvidence, move: args.momentum ?? args.move,
    boostTotal: args.totalBoostAmount, boostIncrement: args.boostAmount,
    confidence: args.confidence, risk: args.risk ?? 'REVIEW',
    insightTitle: args.totalBoostAmount >= MAJOR_BOOST_THRESHOLD ? 'HIGH ATTENTION' : 'VERIFIED EVENT',
    insight: [args.totalBoostAmount >= MAJOR_BOOST_THRESHOLD
      ? 'Cumulative Dex boost activity crossed the major-attention threshold.'
      : 'A material new Dex booster increment was verified.'],
    statusTitle: '🚀 STATUS', status: 'Boost is attention evidence, not a buy recommendation.',
  });
}

export function buildBoostActions(args: {
  tokenAddress: string;
  chartUrl?: string | null;
  opportunityId?: number | null;
  strategyKey?: string | null;
}) {
  const muteCallback = args.strategyKey
    ? `STRAT_TOGGLE_${args.strategyKey}`
    : null;
  return buildAlphaMarketActions({
    chartUrl: args.chartUrl,
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${args.tokenAddress}`,
    copyContractCallback: `COPY_CA_${args.tokenAddress}`,
    trackCallback: args.opportunityId != null ? `OPP_TRACK_${args.opportunityId}` : null,
    muteCallback: muteCallback && Buffer.byteLength(muteCallback, 'utf8') <= 64
      ? muteCallback
      : null,
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
  const previousBoostMarket = await getPreviousBoostMarket(boost.tokenAddress).catch(() => null);

  const opportunity = await getBoostOpportunityContext(boost.tokenAddress);
  const opportunityMarket = normalizeNotificationMarketContext(
    opportunity?.rawData,
    { address: boost.tokenAddress },
  );

  if (!market && !opportunityMarket.preIndexValuation) {
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
      scanRobinhoodDevTokenFlow(
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
    devHolding?.devHoldingPercent ??
    null;

  const burnedPercent =
    devHolding?.totalBurnPercent ??
    null;

  const holderTop1Percent =
    holderRisk?.top1Pct ??
    null;


  const eventId = market
    ? await saveBoostEvent({
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
      })
    : `preindex:${boost.tokenAddress}:${boost.totalAmount}`;


  if (!eventId) {
    return false;
  }

  await persistAlphaSemanticEvent({
    identity: String(eventId), type: 'BOOST', assetId: boost.tokenAddress, chain: 'robinhood',
    intelligenceState: boostNotificationState(boost.totalAmount) === 'BUILDING' ? 'BUILDING' : null,
    strategyKey: opportunity?.strategyKey, symbol: market?.symbol ?? opportunityMarket.symbol,
    rawSnapshot: { boostIncrement: boostAdded, boostTotal: boost.totalAmount, eventType,
      price: market?.priceUsd ?? null, priceProvenance: market ? 'DEXSCREENER_VERIFIED_BASE_PAIR' : null,
      marketCap: market?.marketCapUsd ?? null, fdv: market?.fdvUsd ?? null,
      liquidity: market?.liquidityUsd ?? null, volume5m: market?.volume5mUsd ?? null,
      buys5m: market?.buys5m ?? null, sells5m: market?.sells5m ?? null,
      devHoldingPercent, burnedPercent, chartUrl: market?.chartUrl ?? null },
  });
  const volumeDecision = volumeIgnitionDecision({ previousVolume5m: previousBoostMarket?.volume5m ?? null,
    currentVolume5m: market?.volume5mUsd ?? null, previousPrice: previousBoostMarket?.price ?? null,
    currentPrice: market?.priceUsd ?? null, currentLiquidity: market?.liquidityUsd ?? null,
    buys5m: market?.buys5m ?? null, sells5m: market?.sells5m ?? null });
  if (volumeDecision.eligible) {
    const volumeInserted = await persistAlphaSemanticEvent({ identity: `${eventId}:volume-surge`,
    type: 'VOLUME_SURGE', assetId: boost.tokenAddress, chain: 'robinhood',
    intelligenceState: 'BUILDING', strategyKey: opportunity?.strategyKey,
    symbol: market?.symbol ?? opportunityMarket.symbol,
    rawSnapshot: { previousVolume5m: previousBoostMarket?.volume5m, currentVolume5m: market?.volume5mUsd,
      previousPrice: previousBoostMarket?.price, currentPrice: market?.priceUsd,
      price: market?.priceUsd, priceProvenance: 'DEXSCREENER_VERIFIED_BASE_PAIR',
      volumeMultiple: volumeDecision.volumeMultiple,
      comparisonWindow: 'DEXSCREENER_M5_TO_DEXSCREENER_M5', includedInBoostNotification: false },
  });
    if (volumeInserted && market) {
      await sendTelegram(config.adminTelegramId, buildPremiumTokenNotification({
        state: 'VOLUME_IGNITION', symbol: market.symbol, name: market.name, address: boost.tokenAddress,
        market: normalizeNotificationMarketContext({ marketCap: market.marketCapUsd, fdv: market.fdvUsd,
          liquidity: market.liquidityUsd, volume5m: market.volume5mUsd, chartUrl: market.chartUrl }),
        evidence: normalizeCoreDecisionMetrics({ devHoldingPercent, devHoldingEvidence: devHoldingPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
          burnedPercent, burnEvidence: burnedPercent == null ? 'UNAVAILABLE' : 'VERIFIED' }),
        volumeMultiple: volumeDecision.volumeMultiple,
        insightTitle: 'WHY NOW', insight: ['Comparable 5-minute volume accelerated while price and liquidity avoided collapse.'],
        statusTitle: '🔥 STATUS', status: 'Abnormal activity detected · review current participation.',
      }), buildBoostActions({ tokenAddress: boost.tokenAddress, chartUrl: market.chartUrl,
        opportunityId: opportunity?.id, strategyKey: opportunity?.strategyKey }));
    }
  }


  const message =
    buildBoostMessage({
      symbol:
        market?.symbol ?? opportunityMarket.symbol ?? 'UNKNOWN',

      name:
        market?.name ?? opportunityMarket.name,

      tokenAddress:
        boost.tokenAddress,

      boostAmount:
        boostAdded,

      totalBoostAmount:
        boost.totalAmount,

      price:
        market?.priceUsd,

      marketCap:
        market?.marketCapUsd,

      fdv:
        market?.fdvUsd,

      liquidity:
        market?.liquidityUsd,

      volume5m:
        market?.volume5mUsd,

      buys5m:
        market?.buys5m,

      sells5m:
        market?.sells5m,

      age: contextAge(opportunity?.rawData ?? {}),
      move: contextNumber(opportunity?.rawData ?? {}, 'currentRoi'),
      momentum: contextNumber(opportunity?.rawData ?? {}, 'roiChange'),
      confidence: opportunity?.confidence,
      risk: opportunity?.risk,
      rawData: opportunity?.rawData,
      marketContext: market ? {
        symbol: market.symbol, name: market.name, address: boost.tokenAddress,
        marketCap: market.marketCapUsd, fdv: market.fdvUsd ?? null,
        liquidity: market.liquidityUsd, volume5m: market.volume5mUsd,
        chartUrl: market.chartUrl ?? null,
      } : opportunityMarket,

      devHoldingPercent,

      burnedPercent,

      holderTop1Percent,

      eventType,
    });


  await sendTelegram(
    config.adminTelegramId,
    message,
    buildBoostActions({
      tokenAddress: boost.tokenAddress,
      chartUrl: market?.chartUrl,
      opportunityId: opportunity?.id,
      strategyKey: opportunity?.strategyKey,
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
        market?.symbol ?? opportunityMarket.symbol,

      token:
        boost.tokenAddress,

      eventType,

      boostAdded,

      totalBoost:
        boost.totalAmount,

      marketCap:
        market?.marketCapUsd ?? null,
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
