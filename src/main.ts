/// <reference types="node" />
import { config } from './config.js';
import { supabase } from './services/supabase.js';
import { createBot } from './bot/index.js';
import { buildMessage } from './ui/messageBuilder.js';

import {
  startRobinhoodObserver,
} from './chains/robinhood/robinhoodObserver.js';

import {
  startRobinhoodOutcomeTracker,
} from './chains/robinhood/robinhoodOutcomeTracker.js';

import {
  startRobinhoodBoostObserver,
} from './chains/robinhood/robinhoodBoostObserver.js';

import {
  startPonsShadowSniper,
} from './chains/robinhood/ponsShadowSniper.js';

import {
  startPonsShadowOutcomeTracker,
} from './chains/robinhood/ponsShadowOutcomeTracker.js';

import {
  syncRobinhoodCreatorIntelligence,
} from './chains/robinhood/robinhoodCreatorIntelligence.js';

import { startAnalyticsSummary } from "./services/analyticsSummary.js";
import { captureAlertSnapshot } from './core/tracker.js';
import { pollPumpfunEarlyFeed } from './core/pumpfunWatcher.js';
import { runDexPaidEngine } from './engines/dexPaidEngine.js';
import { getCreatorWalletForToken } from './profiles/tokenCreatorLookup.js';
import { recordDecision } from './services/decisionService.js';
import { runWhaleClusterEngine } from './engines/whaleClusterEngine.js';
import { runPumpEarlyEngine } from './engines/pumpEarlyEngine.js';
import { runSignalPerformanceEngine } from './engines/signalPerformanceEngine.js';
import { buildPumpfunEarlyMessage } from './ui/pumpfunMessageBuilder.js';
import {
  runAutoTradeManager,
  restoreOpenTrades,
  startAdminAutoTrade,
} from './core/autoTradeManager.js';
import { runCreatorMarketTracker } from './agents/creatorMarketTrackerAgent.js';
import { recordTokenMemoryEvent } from './memory/tokenMemoryEvents.js';
import { getAdaptiveLearningAdjustment } from './ai/learningEngine.js';
import { runOutcomeLearning } from './agents/outcomeLearningAgent.js';
import { runCreatorReputationEngine } from './agents/creatorReputationEngine.js';
import { getCreatorProfile } from './profiles/creatorProfile.js';
import { startMemoryTracker } from './agents/memoryTrackerAgent.js';
import { buildProAlertMessage } from './ui/proAlertMessageBuilder.js';
import { startOutcomeCheckpointAgent } from './agents/outcomeCheckpointAgent.js';
import { startOutcomeTracker } from "./services/outcomeTracker.js";
import { startNotificationService } from "./services/notificationService.js";
import { startOpportunityDeliveryService } from "./services/opportunityDeliveryService.js";
import { startOpportunityFreshnessService } from "./services/opportunityFreshnessService.js";
import { startAlphaOutcomeCheckpointService } from './services/alphaAlertOutcomeCheckpoints.js';
import { getAlphaSettings } from './services/settingsService.js';
import {
  hasTokenAlertCreated,
  upsertTokenMemory,
} from './memory/tokenMemory.js';
import {
  syncWalletTradeOutcomes,
  recalculateAllWalletReputations,
} from './agents/walletOutcomeEngine.js';
import {
  createAlertDelivery,
  createAlertRecord,
  expireDueSubscriptions,
  getDeliverableUsers,
  incrementFreeTrialUsed,
  updateAlertPerformance,
  hasAlertDelivery,
} from './core/delivery.js';
import {
  enrichToken,
  fetchBoostMap,
  fetchFallbackProfiles,
  fetchLatestProfiles,
  fetchTakeoverSet,
} from './services/dexscreener.js';
import { sendTelegram } from './services/telegram.js';
import { confirmMomentum } from './services/momentumConfirmation.js';
import type { DexProfile, RiskResult, TokenState } from './types.js';
import { pollWatchedWallets } from './core/walletWatcher.js';
import {
  commitRobinhoodWalletCheckpoints,
  pollRobinhoodTrackedWallets,
} from './chains/robinhood/robinhoodWalletWatcher.js';
import { deliverLegacyAlert } from './core/legacyAlertDelivery.js';

import {
  deliverTrackedWalletActivity,
} from './services/walletActivityDeliveryService.js';
import { enrichTokenByMintAddress } from './services/dexscreener.js';
import { fmtUsd } from './utils/format.js';
import { sleep } from './utils/format.js';

const tokenStates = new Map<string, TokenState>();
const seenTokens = new Set<string>();

function getAlertButtons(
  pair: {
    url?: string | null;
    baseToken?: {
      address?: string;
    } | null;
  },
  options?: {
    isAdmin?: boolean;
  },
) {
  const token =
    pair.baseToken?.address ??
    null;

  const chartUrl =
    pair.url ??
    'https://dexscreener.com';

  const buyUrl =
    token
      ? `https://jup.ag/swap/SOL-${token}`
      : 'https://jup.ag';

  const rows: any[][] = [];

  /*
   * ADMIN ACTION ROW
   *
   * These callback names already exist
   * in bot/commands.ts.
   */
  if (
    options?.isAdmin &&
    token
  ) {
    rows.push([
      {
        text: '⚡ Buy Small',
        callback_data:
          `ADMIN_BUY_SMALL_${token}`,
      },
      {
        text: '🔥 Buy Now',
        callback_data:
          `ADMIN_BUY_DEFAULT_${token}`,
      },
    ]);
  }

  /*
   * PUBLIC ACTION ROW
   *
   * Until per-user wallets are connected,
   * BUY opens the external trading route.
   */
  rows.push([
    {
      text: '📈 Live Chart',
      url: chartUrl,
    },
    {
      text: '🟢 Trade',
      url: buyUrl,
    },
  ]);

  /*
   * Fast contract access.
   *
   * COPY_CA callback currently only
   * supports EVM 0x addresses, so do not
   * use it for Solana yet.
   */

  return rows;
}

async function safeSendTelegram(
  telegramId: string,
  message: string,
  buttons?: any
) {
  try {
    await sendTelegram(telegramId, message, buttons);
    return true;
  } catch (error) {
    console.log('safeSendTelegram failed:', {
      telegramId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function updateSignalStatus(
  alertId: string | undefined,
  status: string,
): Promise<void> {
  if (!alertId) return;

  const { error } = await supabase
    .from('alerts')
    .update({
      signal_status: status,
    })
    .eq('id', alertId);

  if (error) {
    console.error('[SignalStatus] Update failed:', {
      alertId,
      status,
      error: error.message,
    });
  }
}

function getActionBucket(result: RiskResult): 'BUY' | 'HIGH_BUY' | 'IGNORE' {
  const buyRatio =
    result.sells5m <= 0 ? result.buys5m : result.buys5m / result.sells5m;

  if (
    result.score >= 82 &&
    result.marketSafetyScore >= 70 &&
    result.liquidityUsd >= 8_000 &&
    result.liquidityUsd <= 60_000 &&
    result.volume5m >= 8_000 &&
    result.buys5m >= 100 &&
    buyRatio >= 1.8 &&
    result.ageMin <= 45
  ) {
    return 'HIGH_BUY';
  }

  if (
    result.score >= 78 &&
    result.marketSafetyScore >= 60 &&
    result.liquidityUsd >= 10_000 &&
    result.liquidityUsd <= 65_000 &&
    result.volume5m >= 5_000 &&
    result.buys5m >= 60 &&
    buyRatio >= 1.6 &&
    result.ageMin <= 75
  ) {
    return "BUY";
  }

  return 'IGNORE';
}

function shouldStoreCandidate(result: RiskResult) {
  return getActionBucket(result) !== 'IGNORE';
}

async function startPumpfunWatch() {
  console.log('Starting Pump.fun early watch...');

  while (true) {
    try {
      const events = await pollPumpfunEarlyFeed();

      for (const event of events) {
        const creatorProfile = await getCreatorProfile(event.creator ?? null);

        const text = buildPumpfunEarlyMessage({
          symbol: event.symbol,
          name: event.name,
          mint: event.mint,
          creator: event.creator,
          creatorProfile,
          progressPct: event.progressPct,
          buyCount: event.buyCount,
          sellCount: event.sellCount,
          volumeUsd: event.volumeUsd,
          marketCapUsd: event.marketCapUsd,
          launchScore: event.launchScore,
          isMutable: event.isMutable,
        });

        const chartUrl = `https://pump.fun/${event.mint}`;

        await sendTelegram(
          config.ownerChatId,
          text,
          [[{ text: '📈 Open Pump.fun', url: chartUrl }]]
        );
      }
    } catch (error) {
      console.error('pumpfun watch loop error', error);
    }

    await sleep(config.pumpfunPollMs);
  }
}

function shouldSendToAdmin(result: RiskResult) {
  const bucket = getActionBucket(result);
  return bucket === 'BUY' || bucket === 'HIGH_BUY';
}

function shouldSendToPaid(result: RiskResult) {
  const bucket = getActionBucket(result);
  return bucket === 'BUY' || bucket === 'HIGH_BUY';
}

function shouldSendToFree(result: RiskResult) {
  const bucket = getActionBucket(result);
  return bucket === 'BUY' || bucket === 'HIGH_BUY';
}

async function processNewProfiles() {
  const [primaryProfiles, fallbackProfiles, boostMap, takeoverSet] = await Promise.all([
    fetchLatestProfiles(),
    fetchFallbackProfiles(),
    fetchBoostMap(),
    fetchTakeoverSet(),
  ]);

  const profiles = primaryProfiles.length > 0 ? primaryProfiles : fallbackProfiles;

  console.log(`Fetched ${config.discoveryChain} profiles: ${primaryProfiles.length}`);
  console.log(`Fetched ${config.discoveryChain} fallback candidates: ${fallbackProfiles.length}`);
  console.log(`Using source: ${primaryProfiles.length > 0 ? 'token-profiles' : 'fallback'}`);
  console.log(`Profiles to evaluate: ${profiles.length}`);

  for (const profile of profiles) {
    const tokenAddress = profile.tokenAddress;
    if (!tokenAddress) continue;
    if (tokenStates.has(tokenAddress)) continue;

    try {
      const enriched = await enrichToken(profile, boostMap, takeoverSet);

      if (!enriched) {
        console.log('Skip: no pair/enrichment', tokenAddress);
        continue;
      }

      const { pair, result } = enriched;

      const creatorWallet =
        (profile as any).creatorWallet ??
        (profile as any).creator ??
        (await getCreatorWalletForToken(tokenAddress));

      const learningAdjustment =
  await getAdaptiveLearningAdjustment({
    marketCap: result.marketCap,
    liquidity: result.liquidityUsd,
    buys5m: result.buys5m,
    sells5m: result.sells5m,
  });

const effectiveScore = Math.max(
  0,
  Math.min(
    100,
    result.score + learningAdjustment.totalAdjustment
  )
);

const scoredResult = {
  ...result,
  score: effectiveScore,
};

console.log('main adaptive learning adjustment:', {
  token: tokenAddress,
  symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
  baseScore: result.score,
  adjustment: learningAdjustment.totalAdjustment,
  finalScore: effectiveScore,
  reasons: learningAdjustment.reasons,
});

console.log('Candidate check:', {
        token: tokenAddress,
        symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
        liquidity: result.liquidityUsd,
        ageMin: Math.floor(result.ageMin),
        baseScore: result.score,
        score: scoredResult.score,
        buys5m: result.buys5m,
        sells5m: result.sells5m,
        volume5m: result.volume5m,
        paidApproved: result.paidApproved,
        actionBucket: getActionBucket(scoredResult),
      });

      if (seenTokens.has(tokenAddress)) {
        continue;
      }

      const alreadyAlerted =
        await hasTokenAlertCreated(tokenAddress);

      if (alreadyAlerted) {
        console.log(
          `Skip existing database alert: ${tokenAddress}`
        );

        seenTokens.add(tokenAddress);
        continue;
      }

      seenTokens.add(tokenAddress);

      const actionBucket = getActionBucket(scoredResult);

      await recordDecision({
        tokenAddress,
        chain: config.discoveryChain,
        source: 'MAIN_SCANNER',

        symbol: pair.baseToken?.symbol ?? null,
        name: pair.baseToken?.name ?? null,
        creatorWallet,

        baseScore: result.score,
        adjustedScore: scoredResult.score,

        learningAdjustment:
          learningAdjustment.totalAdjustment,

        learningReasons:
          learningAdjustment.reasons,

        actionBucket,
        riskLevel: result.risk,

        marketCap: result.marketCap,
        liquidity: result.liquidityUsd,
        price: result.currentPrice,
        buys5m: result.buys5m,
        sells5m: result.sells5m,
        volume5m: result.volume5m,

        marketSafetyScore:
          result.marketSafetyScore,

        authoritySafetyScore:
          result.authoritySafetyScore,

        paidApproved:
          result.paidApproved,
      });

      if (result.ageMin > config.maxAgeMin) {
        console.log(`Skip age: ${tokenAddress} age=${Math.floor(result.ageMin)} min`);
        continue;
      }

      if (result.liquidityUsd < config.minLiqUsd) {
        console.log(`Skip liquidity: ${tokenAddress} liq=${result.liquidityUsd}`);
        continue;
      }

      if (scoredResult.score < config.minOwnerScore) {
        console.log(
          `Skip score: ${tokenAddress} base=${result.score} adjusted=${scoredResult.score}`
        );
        continue;
      }

            if (result.marketSafetyScore < 60) {
        console.log(`Skip market safety: ${tokenAddress} safety=${result.marketSafetyScore}`);
        continue;
      }

      if (result.authoritySafetyScore < 0) {
        console.log(`Skip authority safety: ${tokenAddress} authority=${result.authoritySafetyScore}`);
        continue;
      }

      if (result.volume5m < 800) {
        console.log(`Skip volume: ${tokenAddress} volume=${result.volume5m}`);
        continue;
      }

      if (result.buys5m < result.sells5m) {
        console.log(`Skip flow: ${tokenAddress} buys=${result.buys5m} sells=${result.sells5m}`);
        continue;
      }

      if (!shouldStoreCandidate(scoredResult)) {
        console.log(
          `Skip bucket: ${tokenAddress} bucket=${getActionBucket(scoredResult)}`
        );
        continue;
      }

      const now = Date.now();

      const alphaSettings = await getAlphaSettings();

      console.log('Entry policy loaded:', {
        token: tokenAddress,
        confirmationSeconds:
          alphaSettings.entryConfirmationSeconds,
        maxEntryDipPercent:
          alphaSettings.maxEntryDipPercent,
        maxEntryPumpPercent:
          alphaSettings.maxEntryPumpPercent,
        minimumBuyRatio:
          alphaSettings.minBuyRatio,
      });

      const state: TokenState = {
        tokenAddress,
        firstSeenAt: now,
        ownerSent: false,
        paidSent: false,
        freeSent: false,
        paidDueAt: now + config.paidDelaySec * 1000,
        freeDueAt: now + config.freeDelaySec * 1000,
        lastScore: scoredResult.score,
        lastPairAddress: pair.pairAddress ?? undefined,
        adminDelivered: false,
        adminEarlyDelivered: false,
        snapshot: scoredResult,
        confirmationDueAt:
          now +
          Math.max(
            15,
            alphaSettings.entryConfirmationSeconds,
          ) *
            1000,
        momentumRetries: 0,
      };

      captureAlertSnapshot(state, result);

      const alertRecord = await createAlertRecord({
        chain: config.discoveryChain,
        tokenAddress,
        pairAddress: pair.pairAddress ?? null,
        symbol: pair.baseToken?.symbol ?? null,
        name: pair.baseToken?.name ?? null,
        scoreAtAlert: scoredResult.score,
        riskAtAlert: result.risk,
        actionAtAlert: getActionBucket(scoredResult),
        alertPrice: result.currentPrice,
        liquidityAtAlert: result.liquidityUsd,
        buys5mAtAlert: result.buys5m,
        sells5mAtAlert: result.sells5m,
        volume5mAtAlert: result.volume5m,
      });

      state.alertId = alertRecord.id;
      tokenStates.set(tokenAddress, state);

      console.log('Candidate queued for confirmation:', {
        token: tokenAddress,
        symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
        confirmationDueAt:
          new Date(
            state.confirmationDueAt ?? Date.now(),
          ).toISOString(),
        initialMarketCap: result.marketCap,
        initialLiquidity: result.liquidityUsd,
        initialScore: scoredResult.score,
      });

      await upsertTokenMemory({
        token: tokenAddress,
        symbol: pair.baseToken?.symbol ?? null,
        name: pair.baseToken?.name ?? null,
        chain: config.discoveryChain,
        creatorWallet,
        marketCap: result.marketCap,
        liquidity: result.liquidityUsd,
        price: result.currentPrice,
        buys: result.buys5m,
        sells: result.sells5m,
        confidence: scoredResult.score,
        riskLevel: result.risk,
        holderScore: result.marketSafetyScore,
        authorityScore: result.authoritySafetyScore,
        raw: {
          source: 'MAIN_ALERT',
          actionBucket: getActionBucket(scoredResult),
          alertId: alertRecord.id,
          creatorWallet,

          baseScore: result.score,
          adjustedScore: scoredResult.score,

          learningAdjustment:
            learningAdjustment.totalAdjustment,

          learningReasons:
            learningAdjustment.reasons,
        },
      });

      await recordTokenMemoryEvent({
        token: tokenAddress,
        chain: config.discoveryChain,
        eventType: 'ALERT_CREATED',
        eventSource: 'MAIN_ALERT',
        marketCap: result.marketCap,
        liquidity: result.liquidityUsd,
        price: result.currentPrice,
        buys: result.buys5m,
        sells: result.sells5m,
        alphaScore: scoredResult.score,
        aiConfidence: scoredResult.score,
        riskLevel: result.risk,
        holderScore: result.marketSafetyScore,
        note: `${pair.baseToken?.symbol ?? tokenAddress} alert created with ${getActionBucket(scoredResult)} bucket`,
        raw: {
          source: 'MAIN_ALERT',
          actionBucket: getActionBucket(scoredResult),
          alertId: alertRecord.id,
          pairAddress: pair.pairAddress ?? null,
          creatorWallet,

          baseScore: result.score,
          adjustedScore: scoredResult.score,

          learningAdjustment:
            learningAdjustment.totalAdjustment,

          learningReasons:
            learningAdjustment.reasons,
        },
      });

      console.log(
        `ALERT STORED: ${pair.baseToken?.symbol ?? tokenAddress} base=${result.score} adjusted=${scoredResult.score} bucket=${getActionBucket(scoredResult)}`
      );

      console.log('ALERT DELIVERY CHECK:', {
        token: tokenAddress,
        symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
        bucket: getActionBucket(scoredResult),
        baseScore: result.score,
        score: scoredResult.score,
        learningAdjustment: learningAdjustment.totalAdjustment,
      });

    } catch (error) {
      console.error('processNewProfiles error', tokenAddress, error);
    }
  }
}

async function startWalletWatch() {
  console.log('Starting private wallet watch...');

  while (true) {
    try {
      const events = await pollWatchedWallets();

      await deliverTrackedWalletActivity(
        events,
      );

      const robinhood = await pollRobinhoodTrackedWallets();
      if (robinhood.checkpointBlock != null) {
        const delivery = await deliverTrackedWalletActivity(robinhood.events);
        const completedWallets = robinhood.wallets.filter(
          wallet => !delivery.failedWallets.has(wallet.toLowerCase()),
        );
        await commitRobinhoodWalletCheckpoints(completedWallets, robinhood.checkpointBlock);
      }

      /*
       * Wallet Telegram delivery is intentionally centralized
       * in deliverTrackedWalletActivity().
       *
       * Do not add another wallet broadcaster here:
       * it creates duplicate alerts and inconsistent UX.
       */
    } catch (error) {
      console.error('wallet watch loop error', error);
    }

    await sleep(config.walletWatchPollMs);
  }
}

let tierDispatchRunning = false;

async function processTierDispatch() {
  if (tierDispatchRunning) {
    return;
  }

  if (!tokenStates.size) {
    return;
  }

  tierDispatchRunning = true;

  try {

  await expireDueSubscriptions();

  const [boostMap, takeoverSet, users] = await Promise.all([
    fetchBoostMap(),
    fetchTakeoverSet(),
    getDeliverableUsers(),
  ]);

  console.log('[TierDispatch] Deliverable users:', users.length);

  const now = Date.now();

  for (const [tokenAddress, state] of tokenStates.entries()) {
    try {
      const profile: DexProfile = { chainId: config.discoveryChain, tokenAddress };
      const enriched = await enrichToken(profile, boostMap, takeoverSet);

      if (!enriched) {
        console.log(
          `Tier cleanup: no enrichment for ${tokenAddress}`,
        );

        await updateSignalStatus(
          state.alertId,
          'REJECTED_NO_DATA',
        );

        tokenStates.delete(tokenAddress);
        continue;
      }

      const { pair, result } = enriched;
      if (state.alertId) {
        await updateAlertPerformance({
            alertId: state.alertId,
            currentPrice: result.currentPrice,
        });
        }
      const publicButtons =
        getAlertButtons(
          pair,
          {
            isAdmin: false,
          },
        );

      const adminButtons =
        getAlertButtons(
          pair,
          {
            isAdmin: true,
          },
        );
      const bucket = getActionBucket(result);

      if (
        state.confirmationDueAt &&
        Date.now() < state.confirmationDueAt
      ) {
        continue;
      }

      const previous = state.snapshot;

      if (previous) {
        const alphaSettings = await getAlphaSettings();

        const momentum = confirmMomentum(
          previous,
          result,
          {
            maxEntryDipPercent:
              alphaSettings.maxEntryDipPercent,

            maxEntryPumpPercent:
              alphaSettings.maxEntryPumpPercent,

            /*
            * These remain initial defaults today.
            * We will move them into strategy_settings next.
            */
            maxLiquidityDropPercent: 12,
            minimumBuyRatio: Math.max(
              1.2,
              alphaSettings.minBuyRatio,
            ),
            maximumBuyRatioDropPercent: 35,
            maximumScoreDrop: 6,
          },
        );

        if (momentum.decision === 'EXTENDED') {
  console.log('Momentum rejected: extended entry', {
    token: tokenAddress,
    symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
    reason: momentum.reason,
    reasons: momentum.reasons,
    metrics: momentum.metrics,
  });

  await recordTokenMemoryEvent({
    token: tokenAddress,
    chain: config.discoveryChain,
    eventType: 'ENTRY_REJECTED_EXTENDED',
    eventSource: 'ENTRY_CONFIRMATION',
    marketCap: result.marketCap,
    liquidity: result.liquidityUsd,
    price: result.currentPrice,
    buys: result.buys5m,
    sells: result.sells5m,
    alphaScore: result.score,
    aiConfidence: result.score,
    riskLevel: result.risk,
    note:
      `${pair.baseToken?.symbol ?? tokenAddress} ` +
      `rejected because entry became extended`,
    raw: {
      reason: momentum.reason,
      reasons: momentum.reasons,
      metrics: momentum.metrics,
      policy: {
        maxEntryDipPercent:
          alphaSettings.maxEntryDipPercent,
        maxEntryPumpPercent:
          alphaSettings.maxEntryPumpPercent,
        minimumBuyRatio: Math.max(
          1.2,
          alphaSettings.minBuyRatio,
        ),
      },
    },
  });

  await updateSignalStatus(
    state.alertId,
    'REJECTED_EXTENDED',
  );

  tokenStates.delete(tokenAddress);
  continue;
}

        if (momentum.decision === 'DOWNTREND') {
        console.log('Momentum rejected:', {
          token: tokenAddress,
          symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
          reason: momentum.reason,
          metrics: momentum.metrics,
        });

        await updateSignalStatus(
          state.alertId,
          'REJECTED_DOWNTREND',
        );

        await recordTokenMemoryEvent({
          token: tokenAddress,
          chain: config.discoveryChain,
          eventType: 'ENTRY_REJECTED_DOWNTREND',
          eventSource: 'ENTRY_CONFIRMATION',
          marketCap: result.marketCap,
          liquidity: result.liquidityUsd,
          price: result.currentPrice,
          buys: result.buys5m,
          sells: result.sells5m,
          alphaScore: result.score,
          aiConfidence: result.score,
          riskLevel: result.risk,
          note:
            `${pair.baseToken?.symbol ?? tokenAddress} ` +
            `rejected because momentum turned down`,
          raw: {
            reason: momentum.reason,
            reasons: momentum.reasons,
            metrics: momentum.metrics,
          },
        });

        tokenStates.delete(tokenAddress);
        continue;
      }

        if (momentum.decision === 'WATCH') {
          const retries = state.momentumRetries ?? 0;

          console.log('Momentum watch:', {
            token: tokenAddress,
            symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
            reason: momentum.reason,
            retry: retries + 1,
            metrics: momentum.metrics,
          });

          if (retries >= 2) {
          console.log('Momentum rejected after retry limit:', {
            token: tokenAddress,
            symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
            metrics: momentum.metrics,
          });

          await updateSignalStatus(
            state.alertId,
            'REJECTED_WATCH',
          );

          await recordTokenMemoryEvent({
            token: tokenAddress,
            chain: config.discoveryChain,
            eventType: 'ENTRY_REJECTED_WATCH',
            eventSource: 'ENTRY_CONFIRMATION',
            marketCap: result.marketCap,
            liquidity: result.liquidityUsd,
            price: result.currentPrice,
            buys: result.buys5m,
            sells: result.sells5m,
            alphaScore: result.score,
            aiConfidence: result.score,
            riskLevel: result.risk,
            note:
              `${pair.baseToken?.symbol ?? tokenAddress} ` +
              `rejected after momentum retry limit`,
            raw: {
              reason: momentum.reason,
              reasons: momentum.reasons,
              metrics: momentum.metrics,
              retries: retries + 1,
            },
          });

          tokenStates.delete(tokenAddress);
          continue;
        }

         state.momentumRetries = retries + 1;

          /*
          * Compare the next check against the latest snapshot,
          * not permanently against the original candidate snapshot.
          */
          state.snapshot = result;

          state.confirmationDueAt =
            Date.now() +
            Math.max(
              15,
              alphaSettings.entryConfirmationSeconds,
            ) *
              1000;

          console.log('Momentum snapshot updated for retry:', {
            token: tokenAddress,
            retry: state.momentumRetries,
            nextCheckSeconds: Math.max(
              15,
              alphaSettings.entryConfirmationSeconds,
            ),
          });

          continue;
        }

        console.log('Momentum confirmed:', {
          token: tokenAddress,
          symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
          reason: momentum.reason,
          reasons: momentum.reasons,
          metrics: momentum.metrics,
        });
      }

      /*
      * Momentum may have remained positive while the token
      * deteriorated enough to fail the latest BUY requirements.
      *
      * Never trade or alert a token whose current bucket is IGNORE.
      */
      if (bucket === 'IGNORE') {
        console.log(
          '[EntryConfirmation] Rejected because latest bucket is IGNORE.',
          {
            token: tokenAddress,
            symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
            score: result.score,
            liquidity: result.liquidityUsd,
            buys5m: result.buys5m,
            sells5m: result.sells5m,
          },
        );

        await updateSignalStatus(
          state.alertId,
          'REJECTED_BUCKET',
        );

        await recordTokenMemoryEvent({
          token: tokenAddress,
          chain: config.discoveryChain,
          eventType: 'ENTRY_REJECTED_BUCKET',
          eventSource: 'ENTRY_CONFIRMATION',
          marketCap: result.marketCap,
          liquidity: result.liquidityUsd,
          price: result.currentPrice,
          buys: result.buys5m,
          sells: result.sells5m,
          alphaScore: result.score,
          aiConfidence: result.score,
          riskLevel: result.risk,
          note:
            `${pair.baseToken?.symbol ?? tokenAddress} ` +
            `passed momentum but no longer qualified for BUY`,
          raw: {
            latestBucket: bucket,
            reason:
              'Latest market snapshot no longer qualifies for BUY',
          },
        });

        tokenStates.delete(tokenAddress);
        continue;
      }

      await updateSignalStatus(
        state.alertId,
        'CONFIRMED',
      );

      try {
  console.log(
    `🤖 AUTO TRADE CANDIDATE: ${
      pair.baseToken?.symbol ?? tokenAddress
    }`,
  );

 await startAdminAutoTrade({
  token: tokenAddress,
  symbol:
    pair.baseToken?.symbol ??
    pair.baseToken?.name ??
    'UNKNOWN',
  entryPrice: result.currentPrice,
  initialLiquidityUsd: result.liquidityUsd,
});
} catch (error) {
  console.error(
    '❌ START AUTO TRADE FAILED:',
    error instanceof Error
      ? error.message
      : String(error),
  );
}


      let alphaMessage: string | null = null;

      state.lastScore = result.score;
      state.lastPairAddress = pair.pairAddress ?? undefined;

      console.log('Tier recheck:', {
        token: tokenAddress,
        symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
        score: result.score,
        liquidity: result.liquidityUsd,
        ageMin: Math.floor(result.ageMin),
        buys5m: result.buys5m,
        sells5m: result.sells5m,
        bucket,
      });

            for (const user of users) {
          const telegramId = user.telegram_id;

          const alreadyDelivered =
          state.alertId
            ? await hasAlertDelivery({
                alertId: state.alertId,
                telegramId,
              })
            : false;

        if (
  user.tier === 'admin' &&
      !state.adminDelivered &&
      !alreadyDelivered
    ) {
      if (!alphaMessage) {
        alphaMessage = buildProAlertMessage({
          pair,
          result,
          state,
          bucket,
        });
      }

      const delivered = await safeSendTelegram(
        telegramId,
        alphaMessage,
        adminButtons,
      );

      if (delivered) {
        state.adminDelivered = true;

        if (state.alertId) {
          await createAlertDelivery({
            alertId: state.alertId,
            chain: config.discoveryChain,
            tokenAddress,
            telegramId,
            tierAtDelivery: 'admin',
            deliveryType: 'instant',
            delaySeconds: 0,
          });
        }

        console.log('Admin alert delivered:', {
          token: tokenAddress,
          symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
          telegramId,
          bucket,
        });
      } else {
        console.error('Admin alert delivery failed:', {
          token: tokenAddress,
          symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
          telegramId,
        });
      }
    }

        if (
          user.tier === 'paid' &&
          user.subscription_status === 'active' &&
          !alreadyDelivered &&
          now >= state.paidDueAt &&
          shouldSendToPaid(result)
        ) {
          if (!alphaMessage) {
          alphaMessage = buildProAlertMessage({
            pair,
            result,
            state,
            bucket,
          });
        }

          await deliverLegacyAlert({
            send: () => safeSendTelegram(
              telegramId,
              alphaMessage!,
              publicButtons,
            ),
            persist: async () => {
              if (!state.alertId) return;
              await createAlertDelivery({
                alertId: state.alertId,
                chain: config.discoveryChain,
                tokenAddress,
                telegramId,
                tierAtDelivery: 'paid',
                deliveryType: 'paid_delay',
                delaySeconds: config.paidDelaySec,
              });
            },
          });
        }

        if (user.tier === 'free') {
          const freeTrialUsed = Number(user.free_trial_used ?? 0);
          const freeTrialLimit = Number(user.free_trial_limit ?? 5);
          const fastDelayActive = freeTrialUsed < freeTrialLimit;
          const freeDelaySec = fastDelayActive ? 60 : 300;
          const freeDueAt = state.firstSeenAt + freeDelaySec * 1000;

          if (
              !alreadyDelivered &&
              now >= freeDueAt &&
              shouldSendToFree(result) &&
              result.liquidityUsd >= config.minLiqUsd &&
              result.buys5m >= result.sells5m
            ) {
            const freeTrialInfo = {
              used: freeTrialUsed,
              limit: freeTrialLimit,
              fastDelayActive,
              freeDelaySec,
            };

            await deliverLegacyAlert({
              send: () => safeSendTelegram(
                telegramId,
                buildMessage({
                  tier: 'FREE',
                  pair,
                  result,
                  state,
                  freeTrialInfo,
                }),
                publicButtons,
              ),
              persist: async () => {
                if (!state.alertId) return;
                await createAlertDelivery({
                  alertId: state.alertId,
                  chain: config.discoveryChain,
                  tokenAddress,
                  telegramId,
                  tierAtDelivery: 'free',
                  deliveryType: fastDelayActive
                    ? 'free_trial_fast'
                    : 'free_delayed',
                  delaySeconds: freeDelaySec,
                });
              },
              consumeFreeTrial: fastDelayActive
                ? () => incrementFreeTrialUsed(telegramId)
                : undefined,
            });
          }
        }
      }


      if (
          result.ageMin > config.maxAgeMin + 300
        ) {
          console.log(
            `Removing tracked token: ${tokenAddress}`,
          );

          tokenStates.delete(tokenAddress);
        }
        } catch (error) {
      console.error(
        "processTierDispatch error",
        tokenAddress,
        error,
      );
    }
  }
  } finally {
    tierDispatchRunning = false;
  }
}

let lastCreatorMarketTrackerRun = 0;

let lastOutcomeLearningRun = 0;

let lastCreatorReputationRun = 0;

let lastWalletOutcomeRun = 0;

function shouldRunCreatorReputationEngine() {
  const intervalMs = Number(
    process.env.CREATOR_REPUTATION_MS ?? 15 * 60 * 1000
  );

  return Date.now() - lastCreatorReputationRun >= intervalMs;
}

function shouldRunOutcomeLearningAgent() {
  const intervalMs = Number(process.env.OUTCOME_LEARNING_MS ?? 10 * 60 * 1000);
  return Date.now() - lastOutcomeLearningRun >= intervalMs;
}

function shouldRunCreatorMarketTracker() {
  const intervalMs = Number(process.env.CREATOR_MARKET_TRACKER_MS ?? 10 * 60 * 1000);
  return Date.now() - lastCreatorMarketTrackerRun >= intervalMs;
}

async function startTierDispatchLoop() {
  console.log(
    "[TierDispatch] Independent 5-second alert dispatch loop started.",
  );

  while (true) {
    try {
      await processTierDispatch();
    } catch (error) {
      console.error(
        "[TierDispatch] Dispatch cycle failed.",
        error,
      );
    }

    await sleep(5_000);
  }
}

async function startPositionProtectionLoop() {
  console.log(
    "[PositionProtection] Independent 5-second protection loop started.",
  );

  while (true) {
    try {
      await runAutoTradeManager();
    } catch (error) {
      console.error(
        "[PositionProtection] Protection cycle failed.",
        error,
      );
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5_000);
    });
  }
}

async function startRobinhoodCreatorIntelligenceLoop() {
  const intervalMs =
    Number(
      process.env.ROBINHOOD_CREATOR_INTEL_MS ??
      5 * 60 * 1000,
    );

  console.log(
    '[RobinhoodCreatorIntel] Automatic sync loop started.',
    {
      intervalSeconds:
        intervalMs / 1000,
    },
  );

  while (true) {
    try {
      await syncRobinhoodCreatorIntelligence();
    } catch (error) {
      console.error(
        '[RobinhoodCreatorIntel] Automatic sync failed:',
        error instanceof Error
          ? error.message
          : String(error),
      );
    }

    await sleep(
      intervalMs,
    );
  }
}

async function startScanner() {
  console.log('Starting momentum risk bot...');

  while (true) {
    try {
      console.log('scanner loop tick');
      await processNewProfiles();
      console.log("1");

      await runDexPaidEngine();
      console.log("2");

      await runPumpEarlyEngine();
      console.log("3");

      await runSignalPerformanceEngine();
      console.log("4");

      await runWhaleClusterEngine();
      console.log("5");

      console.log("Reached creator scheduler");

      if (shouldRunCreatorMarketTracker()) {
    console.log('Running Creator Market Tracker...');

    lastCreatorMarketTrackerRun = Date.now();

    await runCreatorMarketTracker();
}

if (shouldRunCreatorReputationEngine()) {
    console.log('Running Creator Reputation Engine...');

    lastCreatorReputationRun = Date.now();

    await runCreatorReputationEngine();
}
        const walletOutcomeInterval = Number(
          process.env.WALLET_OUTCOME_MS ?? 10 * 60 * 1000
        );

        if (Date.now() - lastWalletOutcomeRun >= walletOutcomeInterval) {
          lastWalletOutcomeRun = Date.now();
          await syncWalletTradeOutcomes();
        }

      if (shouldRunOutcomeLearningAgent()) {
        lastOutcomeLearningRun = Date.now();
        await runOutcomeLearning();
      }
    } catch (error) {
      console.error('main loop error', error);
    }

    await sleep(config.pollMs);
  }
}

async function startBot() {
  console.log('starting Telegram bot...');
  const bot = createBot();
  console.log('bot created');

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    console.log('old webhook cleared');
  } catch (error) {
    console.error('deleteWebhook failed', error);
  }

  await bot.telegram.deleteWebhook().catch(() => {});
  await bot.launch({
    dropPendingUpdates: true,
  });
  console.log('Telegram bot commands are live.');
}

async function main() {
  console.log('main() started');

  startOutcomeTracker();
  startAnalyticsSummary();
  startNotificationService();
  startOpportunityDeliveryService();
  startOpportunityFreshnessService();
  startAlphaOutcomeCheckpointService();

  console.log(
    '🔥🔥🔥 PONS SHADOW STARTUP ENTERED 🔥🔥🔥',
  );

  startPonsShadowSniper();
  startPonsShadowOutcomeTracker();

  console.log(
    '🔥🔥🔥 PONS SHADOW STARTUP COMPLETED 🔥🔥🔥',
  );

  // Restore active trades from Supabase BEFORE starting scanners
  await restoreOpenTrades();

  const tasks = [
    startScanner(),
    startWalletWatch(),
    startPumpfunWatch(),

      // Robinhood Chain
      startRobinhoodObserver(),
      startRobinhoodOutcomeTracker(),
      startRobinhoodBoostObserver(),
      startRobinhoodCreatorIntelligenceLoop(),

    

    startMemoryTracker(),
    startOutcomeCheckpointAgent(),
    startPositionProtectionLoop(),
    startTierDispatchLoop(),
  ];

  if (process.env.RUN_TELEGRAM_BOT === 'true') {
    tasks.unshift(startBot());
  }

  await Promise.all(tasks);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
