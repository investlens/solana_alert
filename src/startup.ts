import { startPumpPortalCreatorFeed } from './core/pumpPortalCreatorFeed.js';
import { startRuntimeHealthHeartbeat } from './services/runtimeHealthHeartbeat.js';
import { startShadowDecisionOutcomeGrader } from './intelligence/shadowDecisionOutcomeGrader.js';
import { startOutcomePatternLearner } from './intelligence/outcomePatternLearner.js';
import { startSystemWatchdog } from './services/systemWatchdog.js';
import { startDexPaidFastLane } from './chains/robinhood/dexPaidFastLane.js';
import { startUndeliveredPonsBoostRecovery } from './chains/robinhood/recoverUndeliveredPonsBoosts.js';
import { createBot } from './bot/index.js';
import { claimTelegramPollingOwner } from './services/telegramPollingOwner.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const enabled = (name: string, fallback = false) =>
  String(process.env[name] ?? (fallback ? 'true' : 'false')).toLowerCase() === 'true';

async function startTelegramPollingEarly() {
  if (!enabled('RUN_TELEGRAM_BOT', false)) return;
  if (!claimTelegramPollingOwner()) {
    console.warn('[TelegramPolling] Early startup duplicate suppressed.');
    return;
  }
  console.log('[TelegramPolling] Starting before database restore...');
  for (;;) {
    const bot = createBot();
    try {
      try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        console.log('[TelegramPolling] Old webhook cleared.');
      } catch (error) {
        console.warn('[TelegramPolling] deleteWebhook failed; continuing with polling.', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await bot.launch({ dropPendingUpdates: false });
      console.warn('[TelegramPolling] Polling stopped unexpectedly; restarting in 3s.');
    } catch (error) {
      console.error('[TelegramPolling] Polling failed; restarting in 3s.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try { bot.stop('polling restart'); } catch {}
    await sleep(3_000);
  }
}

void startTelegramPollingEarly().catch((error) => {
  console.error('[TelegramPolling] Critical supervisor failure:', {
    error: error instanceof Error ? error.message : String(error),
  });
});

if (enabled('PUMPPORTAL_CREATOR_FEED_ENABLED', false)) {
  void startPumpPortalCreatorFeed().catch((error) => {
    console.log('[PumpPortalCreatorFeed] startup error', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
} else console.log('[PumpPortalCreatorFeed] disabled.');

if (enabled('RUNTIME_HEALTH_HEARTBEAT_ENABLED', false)) startRuntimeHealthHeartbeat();
else console.log('[RuntimeHealth] disabled during database recovery.');

if (enabled('SHADOW_OUTCOME_GRADER_ENABLED', false)) startShadowDecisionOutcomeGrader();
else console.log('[ShadowOutcomeGrader] disabled during database recovery.');

if (enabled('OUTCOME_PATTERN_LEARNER_ENABLED', false)) startOutcomePatternLearner();
else console.log('[OutcomePatternLearner] disabled during database recovery.');

if (enabled('SYSTEM_WATCHDOG_DB_ENABLED', false)) startSystemWatchdog();
else console.log('[SystemWatchdog] DB-backed watchdog disabled during database recovery.');

if (enabled('DEX_PAID_FAST_LANE_ENABLED', false)) startDexPaidFastLane();
else console.log('[DexPaidFastLane] disabled during database recovery.');

if (enabled('PONS_BOOST_RECOVERY_ENABLED', false)) startUndeliveredPonsBoostRecovery();
else console.log('[PonsBoostRecovery] disabled during database recovery.');

const fs = await import('node:fs/promises');

if (!enabled('ROBINHOOD_OUTCOME_TRACKER_ENABLED', false)) {
  const trackerPath = new URL('./chains/robinhood/robinhoodOutcomeTracker.ts', import.meta.url);
  const source = await fs.readFile(trackerPath, 'utf8');
  const marker = "export function startRobinhoodOutcomeTracker():\n  void {\n  if (trackerStarted) {";
  const replacement = "export function startRobinhoodOutcomeTracker():\n  void {\n  console.log('[RobinhoodOutcomeTracker] Disabled during database recovery.');\n  return;\n  if (trackerStarted) {";
  if (source.includes(marker)) {
    await fs.writeFile(trackerPath, source.replace(marker, replacement), 'utf8');
    console.log('[Startup] Robinhood outcome tracker recovery guard installed.');
  }
}

if (!enabled('ADMIN_TRADING_ENABLED', false)) {
  const managerPath = new URL('./core/autoTradeManager.ts', import.meta.url);
  let source = await fs.readFile(managerPath, 'utf8');
  const restoreMarker = "export async function restoreOpenTradesForStartup(dependencies: {\n  restore?: typeof restoreOpenTrades;\n  log?: (message: string) => void;\n} = {}): Promise<boolean> {\n  try {";
  const restoreReplacement = "export async function restoreOpenTradesForStartup(dependencies: {\n  restore?: typeof restoreOpenTrades;\n  log?: (message: string) => void;\n} = {}): Promise<boolean> {\n  tradingRestorationStatus = 'READY';\n  console.log('[AutoTrade] Startup restoration skipped because admin trading is disabled.');\n  return true;\n  try {";
  const managerMarker = "export async function runAutoTradeManager() {\n  if (Date.now() - lastRunAt < POSITION_CHECK_INTERVAL_MS) return;";
  const managerReplacement = "export async function runAutoTradeManager() {\n  if (!config.adminTradingEnabled) return;\n  if (Date.now() - lastRunAt < POSITION_CHECK_INTERVAL_MS) return;";
  let changed = false;
  if (source.includes(restoreMarker)) { source = source.replace(restoreMarker, restoreReplacement); changed = true; }
  if (source.includes(managerMarker)) { source = source.replace(managerMarker, managerReplacement); changed = true; }
  if (changed) {
    await fs.writeFile(managerPath, source, 'utf8');
    console.log('[Startup] Disabled-trading recovery guards installed.');
  }
}

// main.ts historically starts all workers unconditionally. Patch only its startup
// orchestration at runtime so production flags are authoritative without changing
// scoring, security, alert delivery, or trading logic.
{
  const mainPath = new URL('./main.ts', import.meta.url);
  let source = await fs.readFile(mainPath, 'utf8');
  const start = source.indexOf('async function main() {');
  const endMarker = "main().catch((err) => {\n  console.error(err);\n  process.exit(1);\n});";
  const end = source.indexOf(endMarker, start);
  if (start >= 0 && end >= 0) {
    const gatedMain = `async function main() {
  console.log('[Startup] main() worker-gated production profile.');
  const tasks: Promise<unknown>[] = [];

  if (process.env.DB_BACKGROUND_WORK_ENABLED === 'true') {
    startOutcomeTracker();
    startAnalyticsSummary();
    startNotificationService();
    startOpportunityDeliveryService();
  } else console.log('[Recovery] DB background services disabled.');

  if (process.env.OPPORTUNITY_FRESHNESS_ENABLED === 'true') startOpportunityFreshnessService();
  if (process.env.ALPHA_OUTCOME_CHECKPOINT_ENABLED === 'true') startAlphaOutcomeCheckpointService();
  if (process.env.LIVE_TRACK_WORKER_ENABLED === 'true') startLiveTrackService();
  if (process.env.PONS_SHADOW_ENABLED === 'true') {
    startPonsShadowServices(config.ponsShadowEnabled, { startSniper: startPonsShadowSniper, startTracker: startPonsShadowOutcomeTracker });
  }

  if (process.env.ADMIN_TRADING_ENABLED === 'true') await restoreOpenTradesForStartup();
  if (process.env.RUN_SCANNER === 'true') { tasks.push(startScanner()); tasks.push(startTierDispatchLoop()); }
  else console.log('[Recovery] Main scanner disabled.');
  if (process.env.WALLET_WATCH_ENABLED === 'true') tasks.push(startWalletWatch());
  if (process.env.PUMPFUN_WATCH_ENABLED === 'true') tasks.push(startPumpfunWatch());
  if (process.env.ROBINHOOD_ONCHAIN_DISCOVERY_ENABLED === 'true') tasks.push(startRobinhoodObserver());
  if (process.env.ROBINHOOD_OUTCOME_TRACKER_ENABLED === 'true') tasks.push(startRobinhoodOutcomeTracker());
  if (process.env.EXISTING_TOKEN_SCANNER_ENABLED === 'true') tasks.push(startExistingTokenOpportunityScanner());
  if (process.env.ROBINHOOD_PONS_AGGREGATOR_ENABLED === 'true') tasks.push(startRobinhoodBoostObserver());
  if (process.env.ROBINHOOD_CREATOR_INTELLIGENCE_ENABLED === 'true') tasks.push(startRobinhoodCreatorIntelligenceLoop());
  if (process.env.MEMORY_TRACKER_ENABLED === 'true') tasks.push(startMemoryTracker());
  if (process.env.OUTCOME_CHECKPOINT_ENABLED === 'true') tasks.push(startOutcomeCheckpointAgent());
  if (process.env.ADMIN_TRADING_ENABLED === 'true') tasks.push(startPositionProtectionLoop());

  // Telegram polling is already supervised by startup.ts; do not start a duplicate here.
  if (!tasks.length) console.log('[Recovery] No main-loop workers enabled.');
  await Promise.all(tasks);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});`;
    source = source.slice(0, start) + gatedMain + source.slice(end + endMarker.length);
    await fs.writeFile(mainPath, source, 'utf8');
    console.log('[Startup] main.ts production worker gates installed.');
  } else {
    throw new Error('[Startup] Unable to install main.ts production worker gates safely.');
  }
}

await import('./main.js');