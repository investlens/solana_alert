/// <reference types="node" />
import { config } from './config.js';
import { supabase } from './services/supabase.js';
import { createBot } from './bot/index.js';
import { buildMessage } from './ui/messageBuilder.js';

import { startRobinhoodObserver } from './chains/robinhood/robinhoodObserver.js';
import { startRobinhoodOutcomeTracker } from './chains/robinhood/robinhoodOutcomeTracker.js';
import { startExistingTokenOpportunityScanner } from './chains/robinhood/existingTokenOpportunityScanner.js';
import { startRobinhoodBoostObserver } from './chains/robinhood/robinhoodBoostObserver.js';
import { startPonsShadowSniper } from './chains/robinhood/ponsShadowSniper.js';
import { startPonsShadowOutcomeTracker } from './chains/robinhood/ponsShadowOutcomeTracker.js';
import { startPonsShadowServices } from './chains/robinhood/ponsShadowStartup.js';
import { syncRobinhoodCreatorIntelligence } from './chains/robinhood/robinhoodCreatorIntelligence.js';
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
import { hasTokenAlertCreated, upsertTokenMemory } from './memory/tokenMemory.js';
import { syncWalletTradeOutcomes } from './agents/walletOutcomeEngine.js';
import { createAlertDelivery, createAlertRecord, expireDueSubscriptions, getDeliverableUsers,
  incrementFreeTrialUsed, updateAlertPerformance, hasAlertDelivery } from './core/delivery.js';
import { enrichToken, fetchBoostMap, fetchFallbackProfiles, fetchLatestProfiles, fetchTakeoverSet } from './services/dexscreener.js';
import { sendTelegram } from './services/telegram.js';
import { claimTelegramPollingOwner } from './services/telegramPollingOwner.js';
import { confirmMomentum } from './services/momentumConfirmation.js';
import type { DexProfile, RiskResult, TokenState } from './types.js';
import { pollWatchedWallets } from './core/walletWatcher.js';
import { pollRobinhoodTrackedWallets } from './chains/robinhood/robinhoodWalletWatcher.js';
import { deliverLegacyAlert } from './core/legacyAlertDelivery.js';
import { deliverTrackedWalletActivity } from './services/walletActivityDeliveryService.js';
import { sleep } from './utils/format.js';
import { startLiveTrackService } from './services/liveTrackService.js';
import { logUnhandledRejection } from './services/backgroundPromiseSafety.js';

process.on('unhandledRejection', reason => logUnhandledRejection(reason));

const tokenStates = new Map<string, TokenState>();
const seenTokens = new Set<string>();

function getAlertButtons(pair: { url?: string | null; baseToken?: { address?: string } | null }) {
  const token = pair.baseToken?.address ?? null;
  const chartUrl = pair.url ?? 'https://dexscreener.com';
  const buyUrl = token ? `https://jup.ag/swap/SOL-${token}` : 'https://jup.ag';
  return [[{ text: '📈 Live Chart', url: chartUrl }, { text: '🟢 Trade', url: buyUrl }]];
}

async function safeSendTelegram(telegramId: string, message: string, buttons?: any) {
  try { await sendTelegram(telegramId, message, buttons); return true; }
  catch (error) { console.log('safeSendTelegram failed:', { error: error instanceof Error ? error.message : String(error) }); return false; }
}

async function updateSignalStatus(alertId: string | undefined, status: string): Promise<void> {
  if (!alertId) return;
  const { error } = await supabase.from('alerts').update({ signal_status: status }).eq('id', alertId);
  if (error) console.error('[SignalStatus] Update failed:', { alertId, status, error: error.message });
}

function getActionBucket(result: RiskResult): 'BUY' | 'HIGH_BUY' | 'IGNORE' {
  const buyRatio = result.sells5m <= 0 ? result.buys5m : result.buys5m / result.sells5m;
  if (result.score >= 82 && result.marketSafetyScore >= 70 && result.liquidityUsd >= 8_000 && result.liquidityUsd <= 60_000 &&
      result.volume5m >= 8_000 && result.buys5m >= 100 && buyRatio >= 1.8 && result.ageMin <= 45) return 'HIGH_BUY';
  if (result.score >= 78 && result.marketSafetyScore >= 60 && result.liquidityUsd >= 10_000 && result.liquidityUsd <= 65_000 &&
      result.volume5m >= 5_000 && result.buys5m >= 60 && buyRatio >= 1.6 && result.ageMin <= 75) return 'BUY';
  return 'IGNORE';
}

async function startPumpfunWatch() {
  console.log('Starting Pump.fun early watch...');
  while (true) {
    try {
      const events = await pollPumpfunEarlyFeed();
      for (const event of events) {
        const creatorProfile = await getCreatorProfile(event.creator ?? null);
        const text = buildPumpfunEarlyMessage({ symbol: event.symbol, name: event.name, mint: event.mint, creator: event.creator,
          creatorProfile, progressPct: event.progressPct, buyCount: event.buyCount, sellCount: event.sellCount,
          volumeUsd: event.volumeUsd, marketCapUsd: event.marketCapUsd, launchScore: event.launchScore, isMutable: event.isMutable });
        await sendTelegram(config.ownerChatId, text, [[{ text: '📈 Open Pump.fun', url: `https://pump.fun/${event.mint}` }]]);
      }
    } catch (error) { console.error('pumpfun watch loop error', error); }
    await sleep(config.pumpfunPollMs);
  }
}

const shouldSendToPaid = (result: RiskResult) => ['BUY', 'HIGH_BUY'].includes(getActionBucket(result));
const shouldSendToFree = (result: RiskResult) => ['BUY', 'HIGH_BUY'].includes(getActionBucket(result));

async function processNewProfiles() {
  const [primaryProfiles, fallbackProfiles, boostMap, takeoverSet] = await Promise.all([
    fetchLatestProfiles(), fetchFallbackProfiles(), fetchBoostMap(), fetchTakeoverSet(),
  ]);
  const profiles = primaryProfiles.length > 0 ? primaryProfiles : fallbackProfiles;
  console.log(`Profiles to evaluate: ${profiles.length}`);
  for (const profile of profiles) {
    const tokenAddress = profile.tokenAddress;
    if (!tokenAddress || tokenStates.has(tokenAddress)) continue;
    try {
      const enriched = await enrichToken(profile, boostMap, takeoverSet);
      if (!enriched) continue;
      const { pair, result } = enriched;
      const creatorWallet = (profile as any).creatorWallet ?? (profile as any).creator ?? (await getCreatorWalletForToken(tokenAddress));
      const learningAdjustment = await getAdaptiveLearningAdjustment({ marketCap: result.marketCap, liquidity: result.liquidityUsd,
        buys5m: result.buys5m, sells5m: result.sells5m });
      const scoredResult = { ...result, score: Math.max(0, Math.min(100, result.score + learningAdjustment.totalAdjustment)) };
      if (seenTokens.has(tokenAddress)) continue;
      if (await hasTokenAlertCreated(tokenAddress)) { seenTokens.add(tokenAddress); continue; }
      seenTokens.add(tokenAddress);
      const actionBucket = getActionBucket(scoredResult);
      await recordDecision({ tokenAddress, chain: config.discoveryChain, source: 'MAIN_SCANNER', symbol: pair.baseToken?.symbol ?? null,
        name: pair.baseToken?.name ?? null, creatorWallet, baseScore: result.score, adjustedScore: scoredResult.score,
        learningAdjustment: learningAdjustment.totalAdjustment, learningReasons: learningAdjustment.reasons, actionBucket,
        riskLevel: result.risk, marketCap: result.marketCap, liquidity: result.liquidityUsd, price: result.currentPrice,
        buys5m: result.buys5m, sells5m: result.sells5m, volume5m: result.volume5m,
        marketSafetyScore: result.marketSafetyScore, authoritySafetyScore: result.authoritySafetyScore, paidApproved: result.paidApproved });
      if (result.ageMin > config.maxAgeMin || result.liquidityUsd < config.minLiqUsd || scoredResult.score < config.minOwnerScore ||
          result.marketSafetyScore < 60 || result.authoritySafetyScore < 0 || result.volume5m < 800 || result.buys5m < result.sells5m ||
          actionBucket === 'IGNORE') continue;
      const alphaSettings = await getAlphaSettings();
      const now = Date.now();
      const state: TokenState = { tokenAddress, firstSeenAt: now, ownerSent: false, paidSent: false, freeSent: false,
        paidDueAt: now + config.paidDelaySec * 1000, freeDueAt: now + config.freeDelaySec * 1000, lastScore: scoredResult.score,
        lastPairAddress: pair.pairAddress ?? undefined, adminDelivered: false, adminEarlyDelivered: false, snapshot: scoredResult,
        confirmationDueAt: now + Math.max(15, alphaSettings.entryConfirmationSeconds) * 1000, momentumRetries: 0 };
      captureAlertSnapshot(state, result);
      const alertRecord = await createAlertRecord({ chain: config.discoveryChain, tokenAddress, pairAddress: pair.pairAddress ?? null,
        symbol: pair.baseToken?.symbol ?? null, name: pair.baseToken?.name ?? null, scoreAtAlert: scoredResult.score,
        riskAtAlert: result.risk, actionAtAlert: actionBucket, alertPrice: result.currentPrice, liquidityAtAlert: result.liquidityUsd,
        buys5mAtAlert: result.buys5m, sells5mAtAlert: result.sells5m, volume5mAtAlert: result.volume5m });
      state.alertId = alertRecord.id; tokenStates.set(tokenAddress, state);
      await upsertTokenMemory({ token: tokenAddress, symbol: pair.baseToken?.symbol ?? null, name: pair.baseToken?.name ?? null,
        chain: config.discoveryChain, creatorWallet, marketCap: result.marketCap, liquidity: result.liquidityUsd, price: result.currentPrice,
        buys: result.buys5m, sells: result.sells5m, confidence: scoredResult.score, riskLevel: result.risk,
        holderScore: result.marketSafetyScore, authorityScore: result.authoritySafetyScore,
        raw: { source: 'MAIN_ALERT', actionBucket, alertId: alertRecord.id, creatorWallet } });
      await recordTokenMemoryEvent({ token: tokenAddress, chain: config.discoveryChain, eventType: 'ALERT_CREATED', eventSource: 'MAIN_ALERT',
        marketCap: result.marketCap, liquidity: result.liquidityUsd, price: result.currentPrice, buys: result.buys5m, sells: result.sells5m,
        alphaScore: scoredResult.score, aiConfidence: scoredResult.score, riskLevel: result.risk, holderScore: result.marketSafetyScore,
        note: `${pair.baseToken?.symbol ?? tokenAddress} alert created with ${actionBucket} bucket`, raw: { alertId: alertRecord.id } });
    } catch (error) { console.error('processNewProfiles error', tokenAddress, error); }
  }
}

async function startWalletWatch() {
  while (true) {
    try { const events = await pollWatchedWallets(); await deliverTrackedWalletActivity(events); await pollRobinhoodTrackedWallets(deliverTrackedWalletActivity); }
    catch (error) { console.error('wallet watch loop error', error); }
    await sleep(config.walletWatchPollMs);
  }
}

let tierDispatchRunning = false;
async function processTierDispatch() {
  if (tierDispatchRunning || !tokenStates.size) return;
  tierDispatchRunning = true;
  try {
    await expireDueSubscriptions();
    const [boostMap, takeoverSet, users] = await Promise.all([fetchBoostMap(), fetchTakeoverSet(), getDeliverableUsers()]);
    const now = Date.now();
    for (const [tokenAddress, state] of tokenStates.entries()) {
      try {
        const enriched = await enrichToken({ chainId: config.discoveryChain, tokenAddress } as DexProfile, boostMap, takeoverSet);
        if (!enriched) { await updateSignalStatus(state.alertId, 'REJECTED_NO_DATA'); tokenStates.delete(tokenAddress); continue; }
        const { pair, result } = enriched;
        if (state.alertId) await updateAlertPerformance({ alertId: state.alertId, currentPrice: result.currentPrice });
        const buttons = getAlertButtons(pair);
        const bucket = getActionBucket(result);
        if (state.confirmationDueAt && Date.now() < state.confirmationDueAt) continue;
        const previous = state.snapshot;
        if (previous) {
          const alphaSettings = await getAlphaSettings();
          const momentum = confirmMomentum(previous, result, { maxEntryDipPercent: alphaSettings.maxEntryDipPercent,
            maxEntryPumpPercent: alphaSettings.maxEntryPumpPercent, maxLiquidityDropPercent: 12,
            minimumBuyRatio: Math.max(1.2, alphaSettings.minBuyRatio), maximumBuyRatioDropPercent: 35, maximumScoreDrop: 6 });
          if (['EXTENDED', 'DOWNTREND'].includes(momentum.decision)) {
            await updateSignalStatus(state.alertId, momentum.decision === 'EXTENDED' ? 'REJECTED_EXTENDED' : 'REJECTED_DOWNTREND');
            tokenStates.delete(tokenAddress); continue;
          }
          if (momentum.decision === 'WATCH') {
            const retries = state.momentumRetries ?? 0;
            if (retries >= 2) { await updateSignalStatus(state.alertId, 'REJECTED_WATCH'); tokenStates.delete(tokenAddress); continue; }
            state.momentumRetries = retries + 1; state.snapshot = result;
            state.confirmationDueAt = Date.now() + Math.max(15, alphaSettings.entryConfirmationSeconds) * 1000; continue;
          }
        }
        if (bucket === 'IGNORE') { await updateSignalStatus(state.alertId, 'REJECTED_BUCKET'); tokenStates.delete(tokenAddress); continue; }
        await updateSignalStatus(state.alertId, 'CONFIRMED');
        let alphaMessage: string | null = null;
        for (const user of users) {
          const telegramId = user.telegram_id;
          const alreadyDelivered = state.alertId ? await hasAlertDelivery({ alertId: state.alertId, telegramId }) : false;
          if (user.tier === 'admin' && !state.adminDelivered && !alreadyDelivered) {
            alphaMessage ??= buildProAlertMessage({ pair, result, state, bucket });
            const delivered = await safeSendTelegram(telegramId, alphaMessage, buttons);
            if (delivered) { state.adminDelivered = true; if (state.alertId) await createAlertDelivery({ alertId: state.alertId,
              chain: config.discoveryChain, tokenAddress, telegramId, tierAtDelivery: 'admin', deliveryType: 'instant', delaySeconds: 0 }); }
          }
          if (user.tier === 'paid' && user.subscription_status === 'active' && !alreadyDelivered && now >= state.paidDueAt && shouldSendToPaid(result)) {
            alphaMessage ??= buildProAlertMessage({ pair, result, state, bucket });
            await deliverLegacyAlert({ send: () => safeSendTelegram(telegramId, alphaMessage!, buttons), persist: async () => {
              if (state.alertId) await createAlertDelivery({ alertId: state.alertId, chain: config.discoveryChain, tokenAddress, telegramId,
                tierAtDelivery: 'paid', deliveryType: 'paid_delay', delaySeconds: config.paidDelaySec }); } });
          }
          if (user.tier === 'free') {
            const freeTrialUsed = Number(user.free_trial_used ?? 0), freeTrialLimit = Number(user.free_trial_limit ?? 5);
            const fastDelayActive = freeTrialUsed < freeTrialLimit, freeDelaySec = fastDelayActive ? 60 : 300;
            if (!alreadyDelivered && now >= state.firstSeenAt + freeDelaySec * 1000 && shouldSendToFree(result) &&
                result.liquidityUsd >= config.minLiqUsd && result.buys5m >= result.sells5m) {
              await deliverLegacyAlert({ send: () => safeSendTelegram(telegramId, buildMessage({ tier: 'FREE', pair, result, state,
                freeTrialInfo: { used: freeTrialUsed, limit: freeTrialLimit, fastDelayActive, freeDelaySec } }), buttons), persist: async () => {
                if (state.alertId) await createAlertDelivery({ alertId: state.alertId, chain: config.discoveryChain, tokenAddress, telegramId,
                  tierAtDelivery: 'free', deliveryType: fastDelayActive ? 'free_trial_fast' : 'free_delayed', delaySeconds: freeDelaySec }); },
                consumeFreeTrial: fastDelayActive ? () => incrementFreeTrialUsed(telegramId) : undefined });
            }
          }
        }
        if (result.ageMin > config.maxAgeMin + 300) tokenStates.delete(tokenAddress);
      } catch (error) { console.error('processTierDispatch error', tokenAddress, error); }
    }
  } finally { tierDispatchRunning = false; }
}

let lastCreatorMarketTrackerRun = 0, lastOutcomeLearningRun = 0, lastCreatorReputationRun = 0, lastWalletOutcomeRun = 0;
const due = (last: number, env: string, fallback: number) => Date.now() - last >= Number(process.env[env] ?? fallback);

async function startTierDispatchLoop() { while (true) { try { await processTierDispatch(); } catch (error) { console.error('[TierDispatch] cycle failed', error); } await sleep(5_000); } }
async function startRobinhoodCreatorIntelligenceLoop() {
  const intervalMs = Number(process.env.ROBINHOOD_CREATOR_INTEL_MS ?? 5 * 60 * 1000);
  while (true) { try { await syncRobinhoodCreatorIntelligence(); } catch (error) { console.error('[RobinhoodCreatorIntel] sync failed', error); } await sleep(intervalMs); }
}
async function startScanner() {
  while (true) {
    try {
      await processNewProfiles(); await runDexPaidEngine(); await runPumpEarlyEngine(); await runSignalPerformanceEngine(); await runWhaleClusterEngine();
      if (due(lastCreatorMarketTrackerRun, 'CREATOR_MARKET_TRACKER_MS', 10 * 60 * 1000)) { lastCreatorMarketTrackerRun = Date.now(); await runCreatorMarketTracker(); }
      if (due(lastCreatorReputationRun, 'CREATOR_REPUTATION_MS', 15 * 60 * 1000)) { lastCreatorReputationRun = Date.now(); await runCreatorReputationEngine(); }
      if (due(lastWalletOutcomeRun, 'WALLET_OUTCOME_MS', 10 * 60 * 1000)) { lastWalletOutcomeRun = Date.now(); await syncWalletTradeOutcomes(); }
      if (due(lastOutcomeLearningRun, 'OUTCOME_LEARNING_MS', 10 * 60 * 1000)) { lastOutcomeLearningRun = Date.now(); await runOutcomeLearning(); }
    } catch (error) { console.error('main loop error', error); }
    await sleep(config.pollMs);
  }
}
async function startBot() {
  if (!claimTelegramPollingOwner()) return;
  const bot = createBot();
  try { await bot.telegram.deleteWebhook({ drop_pending_updates: false }); } catch (error) { console.error('deleteWebhook failed', error); }
  await bot.telegram.deleteWebhook().catch(() => {});
  await bot.launch({ dropPendingUpdates: true });
}

async function main() {
  console.log('main() started — automated trading is disabled; alerts and manual external trade links only.');
  startOutcomeTracker(); startAnalyticsSummary(); startNotificationService(); startOpportunityDeliveryService();
  startOpportunityFreshnessService(); startAlphaOutcomeCheckpointService(); startLiveTrackService();
  startPonsShadowServices(config.ponsShadowEnabled, { startSniper: startPonsShadowSniper, startTracker: startPonsShadowOutcomeTracker });
  const tasks = [startScanner(), startWalletWatch(), startPumpfunWatch(), startRobinhoodObserver(), startRobinhoodOutcomeTracker(),
    startExistingTokenOpportunityScanner(), startRobinhoodBoostObserver(), startRobinhoodCreatorIntelligenceLoop(),
    startMemoryTracker(), startOutcomeCheckpointAgent(), startTierDispatchLoop()];
  if (process.env.RUN_TELEGRAM_BOT === 'true') tasks.unshift(startBot());
  await Promise.all(tasks);
}

main().catch(err => { console.error(err); process.exit(1); });
