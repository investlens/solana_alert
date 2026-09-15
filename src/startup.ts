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
  if (process.env.RUN_TELEGRAM_BOT !== 'true') return;

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

    try {
      bot.stop('polling restart');
    } catch {
      // Best-effort cleanup before recreating the polling client.
    }
    await sleep(3_000);
  }
}

void startTelegramPollingEarly().catch((error) => {
  console.error('[TelegramPolling] Critical supervisor failure:', {
    error: error instanceof Error ? error.message : String(error),
  });
});

if (process.env.PUMPPORTAL_CREATOR_FEED_ENABLED === 'true') {
  void startPumpPortalCreatorFeed().catch((error) => {
    console.log('[PumpPortalCreatorFeed] startup error', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
} else {
  console.log('[PumpPortalCreatorFeed] disabled to protect production database capacity.');
}

if (enabled('RUNTIME_HEALTH_HEARTBEAT_ENABLED', true)) {
  startRuntimeHealthHeartbeat();
} else {
  console.log('[RuntimeHealth] disabled during database recovery.');
}

if (enabled('SHADOW_OUTCOME_GRADER_ENABLED', false)) {
  startShadowDecisionOutcomeGrader();
} else {
  console.log('[ShadowOutcomeGrader] disabled during database recovery.');
}

if (enabled('OUTCOME_PATTERN_LEARNER_ENABLED', false)) {
  startOutcomePatternLearner();
} else {
  console.log('[OutcomePatternLearner] disabled during database recovery.');
}

if (enabled('SYSTEM_WATCHDOG_DB_ENABLED', false)) {
  startSystemWatchdog();
} else {
  console.log('[SystemWatchdog] DB-backed watchdog disabled during database recovery.');
}

// Keep this critical Robinhood/PONS discovery fast lane alive when explicitly enabled.
startDexPaidFastLane();

// Recover verified PONS BOOST events that were persisted during a Railway restart
// but never reached Telegram. Delivery records remain the dedupe authority.
startUndeliveredPonsBoostRecovery();

const fs = await import('node:fs/promises');

// Recovery guard: main.ts currently starts this worker unconditionally. During a
// database incident, patch only its exported startup entry before main.ts imports
// the module. The tracker logic remains intact and can be restored by flipping the
// environment flag back to true. This guard is temporary until workers are split
// into their dedicated queue-backed service.
if (!enabled('ROBINHOOD_OUTCOME_TRACKER_ENABLED', true)) {
  const trackerPath = new URL('./chains/robinhood/robinhoodOutcomeTracker.ts', import.meta.url);
  const source = await fs.readFile(trackerPath, 'utf8');
  const marker = "export function startRobinhoodOutcomeTracker():\n  void {\n  if (trackerStarted) {";
  const replacement = "export function startRobinhoodOutcomeTracker():\n  void {\n  console.log('[RobinhoodOutcomeTracker] Disabled during database recovery.');\n  return;\n  if (trackerStarted) {";

  if (source.includes(marker)) {
    await fs.writeFile(trackerPath, source.replace(marker, replacement), 'utf8');
    console.log('[Startup] Robinhood outcome tracker recovery guard installed.');
  } else {
    console.warn('[Startup] Robinhood outcome tracker recovery guard target not found.');
  }
}

// Admin trading is intentionally disabled in the current production recovery profile.
// Do not let trade-state restoration or the 5-second position manager hold alert startup
// hostage to Supabase while there are no live admin trades to protect.
if (!enabled('ADMIN_TRADING_ENABLED', false)) {
  const managerPath = new URL('./core/autoTradeManager.ts', import.meta.url);
  let source = await fs.readFile(managerPath, 'utf8');

  const restoreMarker = "export async function restoreOpenTradesForStartup(dependencies: {\n  restore?: typeof restoreOpenTrades;\n  log?: (message: string) => void;\n} = {}): Promise<boolean> {\n  try {";
  const restoreReplacement = "export async function restoreOpenTradesForStartup(dependencies: {\n  restore?: typeof restoreOpenTrades;\n  log?: (message: string) => void;\n} = {}): Promise<boolean> {\n  tradingRestorationStatus = 'READY';\n  console.log('[AutoTrade] Startup restoration skipped because admin trading is disabled.');\n  return true;\n  try {";

  const managerMarker = "export async function runAutoTradeManager() {\n  if (Date.now() - lastRunAt < POSITION_CHECK_INTERVAL_MS) return;";
  const managerReplacement = "export async function runAutoTradeManager() {\n  if (!config.adminTradingEnabled) return;\n  if (Date.now() - lastRunAt < POSITION_CHECK_INTERVAL_MS) return;";

  let changed = false;
  if (source.includes(restoreMarker)) {
    source = source.replace(restoreMarker, restoreReplacement);
    changed = true;
  } else {
    console.warn('[Startup] Auto-trade restoration recovery guard target not found.');
  }

  if (source.includes(managerMarker)) {
    source = source.replace(managerMarker, managerReplacement);
    changed = true;
  } else {
    console.warn('[Startup] Auto-trade manager recovery guard target not found.');
  }

  if (changed) {
    await fs.writeFile(managerPath, source, 'utf8');
    console.log('[Startup] Disabled-trading recovery guards installed; alert startup is independent of trade DB state.');
  }
}

await import('./main.js');