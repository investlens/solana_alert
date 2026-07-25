/// <reference types="node" />
import { config } from './config.js';
import { createBot } from './bot/index.js';
import { buildMessage } from './ui/messageBuilder.js';

import { startAnalyticsSummary } from "./services/analyticsSummary.js";
import { buildEarlyAdminMessage } from './ui/earlyAdminMessageBuilder.js';
import { captureAlertSnapshot } from './core/tracker.js';
import { pollPumpfunEarlyFeed } from './core/pumpfunWatcher.js';
import { runDexPaidEngine } from './engines/dexPaidEngine.js';
import { getCreatorWalletForToken } from './profiles/tokenCreatorLookup.js';
import { recordDecision } from './services/decisionService.js';
import { runWhaleClusterEngine } from './engines/whaleClusterEngine.js';
import { runPumpEarlyEngine } from './engines/pumpEarlyEngine.js';
import { runSignalPerformanceEngine } from './engines/signalPerformanceEngine.js';
import { buildPumpfunEarlyMessage } from './ui/pumpfunMessageBuilder.js';
import { runAutoTradeManager } from './core/autoTradeManager.js';
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
import { enrichTokenByMintAddress } from './services/dexscreener.js';
import {
  buildPrivateWalletBuyMessage,
  buildPrivateWalletLaunchMessage,
  buildPrivateWalletSellMessage,
} from './ui/privateMessageBuilder.js';
import { fmtUsd } from './utils/format.js';
import { sleep } from './utils/format.js';

const tokenStates = new Map<string, TokenState>();
const seenTokens = new Set<string>();

function getAlertButtons(pair: {
  url?: string | null;
  baseToken?: { address?: string } | null;
}) {
  const chartUrl = pair.url ?? 'https://dexscreener.com';
  const buyUrl = pair.baseToken?.address
    ? `https://jup.ag/swap/SOL-${pair.baseToken.address}`
    : 'https://jup.ag';

  return [
    [
      { text: '📈 Chart', url: chartUrl },
      { text: '🟢 Buy on Jupiter', url: buyUrl },
    ],
  ];
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
    result.score >= 72 &&
    result.marketSafetyScore >= 60 &&
    result.liquidityUsd >= 6_000 &&
    result.liquidityUsd <= 65_000 &&
    result.volume5m >= 3_000 &&
    result.buys5m >= 40 &&
    buyRatio >= 1.4 &&
    result.ageMin <= 75
  ) {
    return 'BUY';
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
        confirmationDueAt: now + 12_000,
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

      for (const event of events) {
        if (!event.tokenMint) continue;

        const enriched = await enrichTokenByMintAddress(event.tokenMint);
        const pair = enriched?.pair;
        const result = enriched?.result;

        const chartUrl =
        pair?.url ??
        (event.tokenMint?.endsWith('pump')
          ? `https://pump.fun/${event.tokenMint}`
          : null);
        const buyUrl = pair?.baseToken?.address
        ? `https://jup.ag/swap/SOL-${pair.baseToken.address}`
        : event.tokenMint?.endsWith('pump')
          ? `https://pump.fun/${event.tokenMint}`
          : null;
        const tokenName = pair?.baseToken?.symbol || pair?.baseToken?.name || event.tokenMint;
        const marketCap = result?.marketCap ? fmtUsd(result.marketCap) : null;

        if (event.kind === 'buy') {
          await sendTelegram(
            config.adminTelegramId,
            buildPrivateWalletBuyMessage({
              wallet: event.wallet,
              tokenName,
              tokenMint: event.tokenMint,
              marketCap,
              amountSol: event.amountSol,
              chartUrl,
              buyUrl,
            })
          );
        }

        if (event.kind === 'sell') {
          await sendTelegram(
            config.adminTelegramId,
            buildPrivateWalletSellMessage({
              wallet: event.wallet,
              tokenName,
              tokenMint: event.tokenMint,
              marketCap,
              amountSol: event.amountSol,
              chartUrl,
            })
          );
        }

        if (event.kind === 'launch') {
          await sendTelegram(
            config.adminTelegramId,
            buildPrivateWalletLaunchMessage({
              wallet: event.wallet,
              tokenName,
              tokenMint: event.tokenMint,
              chartUrl,
              buyUrl,
            })
          );
        }
      }
    } catch (error) {
      console.error('wallet watch loop error', error);
    }

    await sleep(config.walletWatchPollMs);
  }
}

async function processTierDispatch() {
  if (!tokenStates.size) return;

  await expireDueSubscriptions();

  const [boostMap, takeoverSet, users] = await Promise.all([
    fetchBoostMap(),
    fetchTakeoverSet(),
    getDeliverableUsers(),
  ]);

  const now = Date.now();

  for (const [tokenAddress, state] of tokenStates.entries()) {
    try {
      const profile: DexProfile = { chainId: config.discoveryChain, tokenAddress };
      const enriched = await enrichToken(profile, boostMap, takeoverSet);

      if (!enriched) {
        console.log(`Tier cleanup: no enrichment for ${tokenAddress}`);
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
      const buttons = getAlertButtons(pair);
      const bucket = getActionBucket(result);

      if (
        state.confirmationDueAt &&
        Date.now() < state.confirmationDueAt
      ) {
        continue;
      }

      const previous = state.snapshot;

      if (previous) {
        const momentum = confirmMomentum(previous, result);

        if (momentum.decision === 'DOWNTREND') {
          console.log('Momentum rejected:', {
            token: tokenAddress,
            symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
            reason: momentum.reason,
            metrics: momentum.metrics,
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

            tokenStates.delete(tokenAddress);
            continue;
          }

          state.momentumRetries = retries + 1;
          state.confirmationDueAt = Date.now() + 20_000;

          continue;
        }

        console.log('Momentum confirmed:', {
          token: tokenAddress,
          symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
          metrics: momentum.metrics,
        });
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

        if (user.tier === 'admin' && !state.adminEarlyDelivered) {
          console.log('early admin check:', {
            token: tokenAddress,
            ageMin: result.ageMin,
            liquidityUsd: result.liquidityUsd,
            volume5m: result.volume5m,
            buys5m: result.buys5m,
            sells5m: result.sells5m,
            marketSafetyScore: result.marketSafetyScore,
            authoritySafetyScore: result.authoritySafetyScore,
            passes: isEarlyAdminWatch(result),
          });

          if (isEarlyAdminWatch(result)) {
            await safeSendTelegram(
              telegramId,
              buildEarlyAdminMessage({ pair, result, state }),
              getAdminOnlyButtons(pair)
            );

            state.adminEarlyDelivered = true;
          }
        }

        if (
          user.tier === 'admin' &&
          !state.adminDelivered &&
          !alreadyDelivered &&
          shouldSendToAdmin(result)
        ) {
          if (!alphaMessage) {
            alphaMessage = buildProAlertMessage({
              pair,
              result,
              state,
              bucket,
            });
          }

          await safeSendTelegram(
            telegramId,
            alphaMessage,
            buttons,
          );

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

        await safeSendTelegram(
          telegramId,
          alphaMessage,
          buttons,
        );
          if (state.alertId) {
            await createAlertDelivery({
              alertId: state.alertId,
              chain: config.discoveryChain,
              tokenAddress,
              telegramId,
              tierAtDelivery: 'paid',
              deliveryType: 'paid_delay',
              delaySeconds: config.paidDelaySec,
            });
          }
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

            await safeSendTelegram(
              telegramId,
              buildMessage({ tier: 'FREE', pair, result, state, freeTrialInfo }),
              buttons
            );

            if (state.alertId) {
              await createAlertDelivery({
                alertId: state.alertId,
                chain: config.discoveryChain,
                tokenAddress,
                telegramId,
                tierAtDelivery: 'free',
                deliveryType:
                  fastDelayActive
                    ? 'free_trial_fast'
                    : 'free_delayed',
                delaySeconds: freeDelaySec,
              });
            }

            if (fastDelayActive) {
              await incrementFreeTrialUsed(telegramId);
            }
          }
        }
      }

      state.adminDelivered = true;

      if (result.ageMin > config.maxAgeMin + 300 || bucket === 'IGNORE') {
        console.log(`Removing tracked token: ${tokenAddress}`);
        tokenStates.delete(tokenAddress);
      }
    } catch (error) {
      console.error('processTierDispatch error', tokenAddress, error);
    }
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

async function startScanner() {
  console.log('Starting momentum risk bot...');

  while (true) {
    try {
      console.log('scanner loop tick');
      await processNewProfiles();
      await runDexPaidEngine();
      await runPumpEarlyEngine();
      await runSignalPerformanceEngine();
      await runWhaleClusterEngine();
      await runAutoTradeManager();
      console.log('creator tracker debug: attempting run');

        lastCreatorMarketTrackerRun = Date.now();
        await runCreatorMarketTracker();
        if (shouldRunCreatorReputationEngine()) {
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
      await processTierDispatch();
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

  const tasks = [
    startScanner(),
    startWalletWatch(),
    startPumpfunWatch(),
    startMemoryTracker(),
    startOutcomeCheckpointAgent(),
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

function isEarlyAdminWatch(result: RiskResult) {
  return (
    result.score >= 78 &&
    result.liquidityUsd >= 8_000 &&
    result.liquidityUsd <= 45_000 &&
    result.volume5m >= 5_000 &&
    result.buys5m >= 80 &&
    result.buys5m > result.sells5m * 2 &&
    result.ageMin <= 20 &&
    result.marketSafetyScore >= 65 &&
    result.authoritySafetyScore >= 0
  );
}

function getAdminOnlyButtons(pair: {
  url?: string | null;
  baseToken?: { address?: string } | null;
}) {
  const chartUrl = pair.url ?? 'https://dexscreener.com';
  const mint = pair.baseToken?.address ?? '';

  return [
    [
      { text: '📈 Chart', url: chartUrl },
      { text: 'Buy 0.03 SOL', callback_data: `ADMIN_BUY_SMALL_${mint}` },
      { text: 'Buy 0.05 SOL', callback_data: `ADMIN_BUY_DEFAULT_${mint}` },
    ],
  ];
}