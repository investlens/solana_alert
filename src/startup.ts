import { startPumpPortalCreatorFeed } from './core/pumpPortalCreatorFeed.js';
import { startRuntimeHealthHeartbeat } from './services/runtimeHealthHeartbeat.js';
import { startShadowDecisionOutcomeGrader } from './intelligence/shadowDecisionOutcomeGrader.js';
import { startOutcomePatternLearner } from './intelligence/outcomePatternLearner.js';
import { startSystemWatchdog } from './services/systemWatchdog.js';
import { startDexPaidFastLane } from './chains/robinhood/dexPaidFastLane.js';
import { createBot } from './bot/index.js';
import { claimTelegramPollingOwner } from './services/telegramPollingOwner.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startTelegramPollingEarly() {
  if (process.env.RUN_TELEGRAM_BOT !== 'true') return;

  if (!claimTelegramPollingOwner()) {
    console.warn('[TelegramPolling] Early startup duplicate suppressed.');
    return;
  }

  console.log('[TelegramPolling] Starting before database restore...');

  // Polling is a critical user-facing service. If Telegraf exits because of a
  // transient Telegram/network/handler failure, recreate it and resume instead
  // of leaving the rest of AlphaOS alive with a dead command surface.
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

startRuntimeHealthHeartbeat();
startShadowDecisionOutcomeGrader();
startOutcomePatternLearner();
startSystemWatchdog();
startDexPaidFastLane();

await import('./main.js');