import {
  supabase,
} from '../../services/supabase.js';
import { buildAlphaMarketActions, extractAutomaticSocials } from '../../ui/alphaNotificationActions.js';
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

import { persistOrLoadAlphaSemanticEventRecord } from '../../services/alphaSemanticEventService.js';
import { deliverAlphaSemanticEvent } from '../../services/alphaSemanticDeliveryService.js';
import { buildPremiumTokenNotification, verifiedPairAge } from '../../ui/premiumTokenNotification.js';
import { boostMetadataFallback, resolveBoostMetadata } from './boostMetadataResolver.js';
import { editTelegramMessage, sendTelegramWithMessageId } from '../../services/telegram.js';
import { config } from '../../config.js';


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

const acceptedAdminBoostNotifications = new Set<string>();

export function boostFallbackIdentity(tokenAddress: string, totalBoostAmount: number): string {
  return `${normalize(tokenAddress)}:${totalBoostAmount}`;
}

export function recordAcceptedAdminBoostNotification(tokenAddress: string, totalBoostAmount: number): void {
  acceptedAdminBoostNotifications.add(boostFallbackIdentity(tokenAddress, totalBoostAmount));
}

export async function deliverAdminBoostFallback(args: {
  tokenAddress: string;
  totalBoostAmount: number;
  message: string;
  buttons?: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
}, dependencies: {
  send?: typeof sendTelegramWithMessageId;
  adminTelegramId?: string;
  log?: (event: string, details: Record<string, unknown>) => void;
} = {}): Promise<boolean> {
  const identity = boostFallbackIdentity(args.tokenAddress, args.totalBoostAmount);
  if (acceptedAdminBoostNotifications.has(identity)) return false;
  const log = dependencies.log ?? ((event, details) => console.log(`[RobinhoodBoostObserver] ${event}`, details));
  try {
    await (dependencies.send ?? sendTelegramWithMessageId)(
      dependencies.adminTelegramId ?? config.adminTelegramId,
      args.message,
      args.buttons,
    );
    acceptedAdminBoostNotifications.add(identity);
    log('BOOST_FALLBACK_SENT', { token: normalize(args.tokenAddress), totalBoost: args.totalBoostAmount });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('BOOST_FALLBACK_FAILED', { token: normalize(args.tokenAddress), totalBoost: args.totalBoostAmount,
      reason: reason.replace(/\s+/g, ' ').slice(0, 240) });
    return false;
  }
}

export function resetRobinhoodBoostFallbackForTests(): void {
  acceptedAdminBoostNotifications.clear();
}

let boostObserverStarted =
  false;

let boostObserverRunning =
  false;

let boostBaselineReady = false;
let boostBaselinePromise: Promise<boolean> | null = null;

let boostObserverInterval:
  | ReturnType<typeof setInterval>
  | null = null;

async function ensureBoostBaseline(): Promise<boolean> {
  if (boostBaselineReady) return true;
  if (boostBaselinePromise) return boostBaselinePromise;
  boostBaselinePromise = (async () => {
    try {
      const boosts = await fetchRobinhoodBoosts();
      for (const boost of boosts) {
        const storedTotal = await getLastStoredBoostTotal(boost.tokenAddress);
        boostTotals.set(normalize(boost.tokenAddress), storedTotal ?? boost.totalAmount);
      }
      boostBaselineReady = true;
      console.log('[RobinhoodBoostObserver] Baseline ready:', { tokens: boosts.length });
      return true;
    } catch (error) {
      console.error('[RobinhoodBoostObserver] Baseline failed:',
        error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      boostBaselinePromise = null;
    }
  })();
  return boostBaselinePromise;
}


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

    return `preindex:${normalize(args.tokenAddress)}:${args.totalBoostAmount}`;
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
  rawData?: Record<string, unknown> | null;
}) {
  const muteCallback = args.strategyKey
    ? `STRAT_TOGGLE_${args.strategyKey}`
    : null;
  const socials = extractAutomaticSocials(args.rawData);
  return buildAlphaMarketActions({
    chartUrl: args.chartUrl,
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${args.tokenAddress}`,
    fullIntelCallback: `FI_RH_${args.tokenAddress}`,
    copyContractCallback: `COPY_CA_${args.tokenAddress}`,
    trackCallback: args.opportunityId != null ? `OPP_TRACK_${args.opportunityId}` : null,
    muteCallback: muteCallback && Buffer.byteLength(muteCallback, 'utf8') <= 64
      ? muteCallback
      : null,
    xUrl: socials.xUrl, telegramUrl: socials.telegramUrl,
  });
}

export async function enrichDeliveredBoostAlert(args: {
  eventId: number; tokenAddress: string; original: any;
}, options: { delayMs?: number } = {}): Promise<number> {
  if ((options.delayMs ?? 2_000) > 0) await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 2_000));
  const metadata = await resolveBoostMetadata(args.tokenAddress, null, 1_200);
  if (!metadata.name && !metadata.symbol) return 0;
  const original = args.original;
  const message = buildBoostMessage({
    symbol: metadata.symbol ?? boostMetadataFallback(args.tokenAddress).symbol!, name: metadata.name,
    tokenAddress: args.tokenAddress, boostAmount: original.boostAdded,
    totalBoostAmount: original.totalBoostAmount, price: original.market?.priceUsd,
    marketCap: original.market?.marketCapUsd, fdv: original.market?.fdvUsd,
    liquidity: original.market?.liquidityUsd, volume5m: original.market?.volume5mUsd,
    buys5m: original.market?.buys5m, sells5m: original.market?.sells5m,
    age: verifiedPairAge(original.market?.pairCreatedAt),
    move: contextNumber(original.opportunity?.rawData ?? {}, 'currentRoi'),
    momentum: contextNumber(original.opportunity?.rawData ?? {}, 'roiChange'),
    confidence: original.opportunity?.confidence, risk: original.opportunity?.risk,
    rawData: original.opportunity?.rawData,
    marketContext: original.market ? { symbol: metadata.symbol, name: metadata.name,
      address: args.tokenAddress, price: original.market.priceUsd, marketCap: original.market.marketCapUsd,
      fdv: original.market.fdvUsd ?? null, liquidity: original.market.liquidityUsd,
      volume5m: original.market.volume5mUsd, chartUrl: original.market.chartUrl ?? null }
      : { ...original.opportunityMarket, symbol: metadata.symbol, name: metadata.name },
    devHoldingPercent: original.devHoldingPercent, burnedPercent: original.burnedPercent,
    holderTop1Percent: original.holderTop1Percent, eventType: original.eventType,
  });
  const buttons = buildBoostActions({ tokenAddress: args.tokenAddress, chartUrl: original.market?.chartUrl,
    opportunityId: original.opportunity?.id, strategyKey: original.opportunity?.strategyKey,
    rawData: original.opportunity?.rawData });
  const { data, error } = await supabase.from('alpha_alert_event_deliveries').select('id,telegram_id,metadata')
    .eq('alert_event_id', args.eventId).eq('delivery_channel', 'telegram').not('delivered_at', 'is', null);
  if (error) throw error;
  let edited = 0;
  for (const delivery of data ?? []) {
    const messageId = Number((delivery.metadata as any)?.telegram_message_id);
    if (!Number.isFinite(messageId)) continue;
    await editTelegramMessage(delivery.telegram_id, messageId, message, buttons);
    await supabase.from('alpha_alert_event_deliveries').update({ metadata: {
      ...(delivery.metadata as Record<string, unknown>), metadata_enriched: true,
      metadata_source: metadata.source, metadata_enriched_at: new Date().toISOString(),
    } }).eq('id', delivery.id);
    edited += 1;
  }
  return edited;
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
      { priority: 'NORMAL', caller: 'robinhood_boost_observer', queueWaitTimeoutMs: 750 },
    ).catch((error) => {
      console.warn('[RobinhoodBoostObserver] Optional market context unavailable:',
        error instanceof Error ? error.message : String(error));
      return null;
    });
  const previousBoostMarket = await getPreviousBoostMarket(boost.tokenAddress).catch(() => null);

  const opportunity = await getBoostOpportunityContext(boost.tokenAddress);
  const opportunityMarket = normalizeNotificationMarketContext(
    opportunity?.rawData,
    { address: boost.tokenAddress },
  );

  const existingEvidence = normalizeCoreDecisionMetrics(opportunity?.rawData);
  const devHoldingPercent = existingEvidence.devHoldingEvidence === 'VERIFIED'
    ? existingEvidence.devHoldingPercent : null;
  const burnedPercent = existingEvidence.burnEvidence === 'VERIFIED'
    ? existingEvidence.burnedPercent : null;
  const holderTop1Percent = null;
  const resolvedMetadata = await resolveBoostMetadata(boost.tokenAddress, {
    symbol: market?.symbol ?? opportunityMarket.symbol,
    name: market?.name ?? opportunityMarket.name,
    source: market ? 'DEXSCREENER_MARKET' : 'OPPORTUNITY_CONTEXT',
  }, 650).catch(() => boostMetadataFallback(boost.tokenAddress));
  const deliveryMetadata = resolvedMetadata.symbol || resolvedMetadata.name
    ? resolvedMetadata : boostMetadataFallback(boost.tokenAddress);


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


  let semanticPersistenceFailed = false;
  const boostEvent = await persistOrLoadAlphaSemanticEventRecord({
      identity: String(eventId), type: 'BOOST', assetId: boost.tokenAddress, chain: 'robinhood',
      intelligenceState: boostNotificationState(boost.totalAmount) === 'BUILDING' ? 'BUILDING' : null,
      strategyKey: opportunity?.strategyKey, symbol: market?.symbol ?? opportunityMarket.symbol,
      rawSnapshot: { boostIncrement: boostAdded, boostTotal: boost.totalAmount, eventType,
        price: market?.priceUsd ?? null, priceProvenance: market ? 'DEXSCREENER_VERIFIED_BASE_PAIR' : null,
        marketCap: market?.marketCapUsd ?? null, fdv: market?.fdvUsd ?? null,
        liquidity: market?.liquidityUsd ?? null, volume5m: market?.volume5mUsd ?? null,
        buys5m: market?.buys5m ?? null, sells5m: market?.sells5m ?? null,
        pairCreatedAt: market?.pairCreatedAt ?? null,
        devHoldingPercent, devHoldingEvidence: devHoldingPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
        burnedPercent, burnEvidence: burnedPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
        chartUrl: market?.chartUrl ?? null },
    }).catch(error => {
      semanticPersistenceFailed = true;
      console.warn('[RobinhoodBoostObserver] Semantic event unavailable; admin fallback eligible:', {
        token: boost.tokenAddress,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
  try {
    const volumeDecision = volumeIgnitionDecision({ previousVolume5m: previousBoostMarket?.volume5m ?? null,
    currentVolume5m: market?.volume5mUsd ?? null, previousPrice: previousBoostMarket?.price ?? null,
    currentPrice: market?.priceUsd ?? null, currentLiquidity: market?.liquidityUsd ?? null,
    buys5m: market?.buys5m ?? null, sells5m: market?.sells5m ?? null });
  if (volumeDecision.eligible) {
    const volumeEvent = await persistOrLoadAlphaSemanticEventRecord({ identity: `${eventId}:volume-surge`,
    type: 'VOLUME_SURGE', assetId: boost.tokenAddress, chain: 'robinhood',
    intelligenceState: 'BUILDING', strategyKey: opportunity?.strategyKey,
    symbol: deliveryMetadata.symbol,
    rawSnapshot: { previousVolume5m: previousBoostMarket?.volume5m, currentVolume5m: market?.volume5mUsd,
      previousPrice: previousBoostMarket?.price, currentPrice: market?.priceUsd,
      price: market?.priceUsd, priceProvenance: 'DEXSCREENER_VERIFIED_BASE_PAIR',
      volumeMultiple: volumeDecision.volumeMultiple,
      comparisonWindow: 'DEXSCREENER_M5_TO_DEXSCREENER_M5', includedInBoostNotification: false },
  });
    if (volumeEvent && market) {
      await deliverAlphaSemanticEvent({ event: { id: volumeEvent.id, eventIdentity: volumeEvent.event_identity,
        type: 'VOLUME_SURGE', assetId: boost.tokenAddress, chain: 'robinhood', strategyKey: opportunity?.strategyKey },
        message: buildPremiumTokenNotification({
        state: 'VOLUME_IGNITION', symbol: market.symbol, name: market.name, address: boost.tokenAddress,
        market: normalizeNotificationMarketContext({ marketCap: market.marketCapUsd, fdv: market.fdvUsd,
          price: market.priceUsd, liquidity: market.liquidityUsd, volume5m: market.volume5mUsd, chartUrl: market.chartUrl }),
        evidence: normalizeCoreDecisionMetrics({ devHoldingPercent, devHoldingEvidence: devHoldingPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
          burnedPercent, burnEvidence: burnedPercent == null ? 'UNAVAILABLE' : 'VERIFIED' }),
        volumeMultiple: volumeDecision.volumeMultiple,
        insightTitle: 'WHY NOW', insight: ['Comparable 5-minute volume accelerated while price and liquidity avoided collapse.'],
        statusTitle: '🔥 STATUS', status: 'Abnormal activity detected · review current participation.',
      }), buttons: buildBoostActions({ tokenAddress: boost.tokenAddress, chartUrl: market.chartUrl,
        opportunityId: opportunity?.id, strategyKey: opportunity?.strategyKey, rawData: opportunity?.rawData }) });
    }
    }
  } catch (error) {
    console.warn('[RobinhoodBoostObserver] Optional volume event unavailable:', {
      token: boost.tokenAddress,
      reason: error instanceof Error ? error.message : String(error),
    });
  }


  const message =
    buildBoostMessage({
      symbol: deliveryMetadata.symbol ?? boostMetadataFallback(boost.tokenAddress).symbol!,

      name: deliveryMetadata.name,

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

      age: verifiedPairAge(market?.pairCreatedAt),
      move: contextNumber(opportunity?.rawData ?? {}, 'currentRoi'),
      momentum: contextNumber(opportunity?.rawData ?? {}, 'roiChange'),
      confidence: opportunity?.confidence,
      risk: opportunity?.risk,
      rawData: opportunity?.rawData,
      marketContext: market ? {
        symbol: market.symbol, name: market.name, address: boost.tokenAddress,
        price: market.priceUsd,
        marketCap: market.marketCapUsd, fdv: market.fdvUsd ?? null,
        liquidity: market.liquidityUsd, volume5m: market.volume5mUsd,
        chartUrl: market.chartUrl ?? null,
      } : opportunityMarket,

      devHoldingPercent,

      burnedPercent,

      holderTop1Percent,

      eventType,
    });


  const buttons = buildBoostActions({
    tokenAddress: boost.tokenAddress,
    chartUrl: market?.chartUrl,
    opportunityId: opportunity?.id,
    strategyKey: opportunity?.strategyKey,
    rawData: opportunity?.rawData,
  });
  const fallbackIdentity = boostFallbackIdentity(boost.tokenAddress, boost.totalAmount);
  let adminDeliveryFailed = semanticPersistenceFailed;
  let adminTelegramFailed = false;
  if (boostEvent) {
    try {
      await deliverAlphaSemanticEvent({ event: { id: boostEvent.id,
        eventIdentity: boostEvent.event_identity, type: 'BOOST', assetId: boost.tokenAddress,
        chain: 'robinhood', strategyKey: opportunity?.strategyKey }, message, buttons,
        onTelegramAccepted: user => {
          if (user.tier === 'admin' || user.telegram_id === config.adminTelegramId) {
            recordAcceptedAdminBoostNotification(boost.tokenAddress, boost.totalAmount);
          }
        },
        onRecipientFailure: (user, _error, stage) => {
          if (user.tier === 'admin' || user.telegram_id === config.adminTelegramId) {
            if (stage === 'telegram_send') adminTelegramFailed = true;
            else adminDeliveryFailed = true;
          }
        },
      });
    } catch (error) {
      adminDeliveryFailed = true;
      console.warn('[RobinhoodBoostObserver] Semantic delivery unavailable; admin fallback eligible:', {
        token: boost.tokenAddress,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let notificationHandled = !adminDeliveryFailed;
  if (adminDeliveryFailed && !adminTelegramFailed && !acceptedAdminBoostNotifications.has(fallbackIdentity)) {
    notificationHandled = await deliverAdminBoostFallback({
      tokenAddress: boost.tokenAddress,
      totalBoostAmount: boost.totalAmount,
      message,
      buttons,
    });
  }

  if (boostEvent && (!resolvedMetadata.name || resolvedMetadata.source === 'SHORTENED_TOKEN_ADDRESS')) {
    void enrichDeliveredBoostAlert({ eventId: boostEvent.id, tokenAddress: boost.tokenAddress,
      original: { boostAdded, totalBoostAmount: boost.totalAmount, market, opportunity, opportunityMarket,
        devHoldingPercent, burnedPercent, holderTop1Percent, eventType } }).catch(error =>
      console.warn('[RobinhoodBoostObserver] Late metadata enrichment failed:',
        error instanceof Error ? error.message : String(error)));
  }


  if (!adminTelegramFailed && (notificationHandled || acceptedAdminBoostNotifications.has(fallbackIdentity))) {
    boostTotals.set(tokenKey, boost.totalAmount);
  }


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


  return !adminTelegramFailed && (notificationHandled || acceptedAdminBoostNotifications.has(fallbackIdentity));
}


export async function runRobinhoodBoostObserverCycle():
Promise<void> {
  if (boostObserverRunning) {
    return;
  }

  boostObserverRunning =
    true;

  try {
    if (!await ensureBoostBaseline()) return;
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
  void ensureBoostBaseline();


  boostObserverInterval =
    setInterval(
      () => {
        void runRobinhoodBoostObserverCycle();
      },
      BOOST_INTERVAL_MS,
    );


  return boostObserverInterval;
}
