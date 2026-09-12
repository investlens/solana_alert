import { startPumpPortalCreatorFeed } from './core/pumpPortalCreatorFeed.js';
import { startRuntimeHealthHeartbeat } from './services/runtimeHealthHeartbeat.js';
import { startShadowDecisionOutcomeGrader } from './intelligence/shadowDecisionOutcomeGrader.js';
import { startOutcomePatternLearner } from './intelligence/outcomePatternLearner.js';
import { startSystemWatchdog } from './services/systemWatchdog.js';
import { startDexPaidFastLane } from './chains/robinhood/dexPaidFastLane.js';
import { createBot } from './bot/index.js';
import { claimTelegramPollingOwner } from './services/telegramPollingOwner.js';

async function startTelegramPollingEarly() {
  if (process.env.RUN_TELEGRAM_BOT !== 'true') return;

  if (!claimTelegramPollingOwner()) {
    console.warn('[TelegramPolling] Early startup duplicate suppressed.');
    return;
  }

  console.log('[TelegramPolling] Starting before database restore...');
  const bot = createBot();

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    console.log('[TelegramPolling] Old webhook cleared.');
  } catch (error) {
    console.warn('[TelegramPolling] deleteWebhook failed; continuing with polling.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await bot.launch({ dropPendingUpdates: false });
  console.log('[TelegramPolling] Bot commands are live.');
}

void startTelegramPollingEarly().catch((error) => {
  console.error('[TelegramPolling] Early startup failed:', {
    error: error instanceof Error ? error.message : String(error),
  });
});

void startPumpPortalCreatorFeed().catch((error) => {
  console.log('[PumpPortalCreatorFeed] startup error', {
    error: error instanceof Error ? error.message : String(error),
  });
});

startRuntimeHealthHeartbeat();
startShadowDecisionOutcomeGrader();
startOutcomePatternLearner();
startSystemWatchdog();
startDexPaidFastLane();

await import('./main.js');