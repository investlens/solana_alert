/// <reference types="node" />
import { config } from './config.js';
import { createBot } from './bot/index.js';
import { buildEarlyAdminMessage } from './ui/earlyAdminMessageBuilder.js';
import { captureAlertSnapshot } from './core/tracker.js';
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
import type { DexProfile, RiskResult, TokenState } from './types.js';
import { pollWatchedWallets } from './core/walletWatcher.js';
import { enrichTokenByMintAddress } from './services/dexscreener.js';
import {
  buildPrivateWalletBuyMessage,
  buildPrivateWalletLaunchMessage,
} from './ui/privateMessageBuilder.js';
import { fmtUsd } from './utils/format.js';
import { sleep } from './utils/format.js';
import { buildMessage } from './ui/messageBuilder.js';

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
      { text: '🟢 Buy', url: buyUrl },
    ],
  ];
}

function getActionBucket(result: RiskResult): 'MEDIUM_BUY' | 'BUY' | 'HIGH_BUY' | 'IGNORE' {
  if (result.score >= 82 && result.marketSafetyScore >= 75) return 'HIGH_BUY';
  if (result.score >= 68) return 'BUY';
  if (result.score >= 60) return 'MEDIUM_BUY';
  return 'IGNORE';
}

function shouldStoreCandidate(result: RiskResult) {
  return getActionBucket(result) !== 'IGNORE';
}

function shouldSendToAdmin(result: RiskResult) {
  const bucket = getActionBucket(result);
  return bucket === 'MEDIUM_BUY' || bucket === 'BUY' || bucket === 'HIGH_BUY';
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

      console.log('Candidate check:', {
        token: tokenAddress,
        symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
        liquidity: result.liquidityUsd,
        ageMin: Math.floor(result.ageMin),
        score: result.score,
        buys5m: result.buys5m,
        sells5m: result.sells5m,
        volume5m: result.volume5m,
        paidApproved: result.paidApproved,
        actionBucket: getActionBucket(result),
      });

      if (seenTokens.has(tokenAddress)) continue;
      seenTokens.add(tokenAddress);

      if (result.ageMin > config.maxAgeMin) {
        console.log(`Skip age: ${tokenAddress} age=${Math.floor(result.ageMin)} min`);
        continue;
      }

      if (result.liquidityUsd < config.minLiqUsd) {
        console.log(`Skip liquidity: ${tokenAddress} liq=${result.liquidityUsd}`);
        continue;
      }

      if (result.score < config.minOwnerScore) {
        console.log(`Skip score: ${tokenAddress} score=${result.score}`);
        continue;
      }

      if (!shouldStoreCandidate(result)) {
        console.log(`Skip bucket: ${tokenAddress} bucket=${getActionBucket(result)}`);
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
        lastScore: result.score,
        lastPairAddress: pair.pairAddress ?? undefined,
        adminDelivered: false,
        adminEarlyDelivered: false,
      };

      captureAlertSnapshot(state, result);

      const alertRecord = await createAlertRecord({
        chain: config.discoveryChain,
        tokenAddress,
        pairAddress: pair.pairAddress ?? null,
        symbol: pair.baseToken?.symbol ?? null,
        name: pair.baseToken?.name ?? null,
        scoreAtAlert: result.score,
        riskAtAlert: result.risk,
        actionAtAlert: getActionBucket(result),
        alertPrice: result.currentPrice,
        liquidityAtAlert: result.liquidityUsd,
        buys5mAtAlert: result.buys5m,
        sells5mAtAlert: result.sells5m,
        volume5mAtAlert: result.volume5m,
      });

      state.alertId = alertRecord.id;
      tokenStates.set(tokenAddress, state);

      console.log(
        `ALERT STORED: ${pair.baseToken?.symbol ?? tokenAddress} score=${result.score} bucket=${getActionBucket(result)}`
      );
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

        const chartUrl = pair?.url ?? null;
        const buyUrl = pair?.baseToken?.address
          ? `https://jup.ag/swap/SOL-${pair.baseToken.address}`
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

        if (
          user.tier === 'admin' &&
          !state.adminEarlyDelivered &&
          isEarlyAdminWatch(result)
        ) {
          await sendTelegram(
            telegramId,
            buildEarlyAdminMessage({ pair, result, state }),
            getAdminOnlyButtons(pair)
          );

          state.adminEarlyDelivered = true;
        }

        if (user.tier === 'admin' && !state.adminDelivered && shouldSendToAdmin(result)) {
          await sendTelegram(
            telegramId,
            buildMessage({ tier: 'OWNER', pair, result, state }),
            buttons
          );

          if (state.alertId) {
            await createAlertDelivery({
              alertId: state.alertId,
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
          now >= state.paidDueAt &&
          shouldSendToPaid(result)
        ) {
          await sendTelegram(
            telegramId,
            buildMessage({ tier: 'PAID', pair, result, state }),
            buttons
          );

          if (state.alertId) {
            await createAlertDelivery({
              alertId: state.alertId,
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

            await sendTelegram(
              telegramId,
              buildMessage({ tier: 'FREE', pair, result, state, freeTrialInfo }),
              buttons
            );

            if (state.alertId) {
              await createAlertDelivery({
                alertId: state.alertId,
                telegramId,
                tierAtDelivery: 'free',
                deliveryType: fastDelayActive ? 'free_trial_fast' : 'free_delayed',
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
      state.paidSent = true;
      state.freeSent = true;

      if (result.ageMin > config.maxAgeMin + 300 || bucket === 'IGNORE') {
        console.log(`Removing tracked token: ${tokenAddress}`);
        tokenStates.delete(tokenAddress);
      }
    } catch (error) {
      console.error('processTierDispatch error', tokenAddress, error);
    }
  }
}

async function startScanner() {
  console.log('Starting momentum risk bot...');

  while (true) {
    try {
      console.log('scanner loop tick');
      await processNewProfiles();
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

  await bot.launch();
  console.log('Telegram bot commands are live.');
}

async function main() {
  console.log('main() started');
  await Promise.all([startBot(), startScanner(), startWalletWatch()]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function isEarlyAdminWatch(result: RiskResult) {
  return (
    result.ageMin <= 5 &&
    result.liquidityUsd >= 3000 &&
    result.volume5m >= 800 &&
    result.buys5m >= result.sells5m &&
    result.marketSafetyScore >= 55 &&
    result.authoritySafetyScore >= 40
  );
}

function getAdminOnlyButtons(pair: {
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
      { text: '🟢 Buy', url: buyUrl },
    ],
  ];
}