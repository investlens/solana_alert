import { startPumpPortalCreatorFeed } from './core/pumpPortalCreatorFeed.js';
import { startRuntimeHealthHeartbeat } from './services/runtimeHealthHeartbeat.js';
import { startShadowDecisionOutcomeGrader } from './intelligence/shadowDecisionOutcomeGrader.js';
import { startOutcomePatternLearner } from './intelligence/outcomePatternLearner.js';
import { startSystemWatchdog } from './services/systemWatchdog.js';
import { startDexPaidFastLane } from './chains/robinhood/dexPaidFastLane.js';
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

// Keep this critical Robinhood/PONS discovery fast lane alive.
startDexPaidFastLane();

await import('./main.js');