import { startPumpPortalCreatorFeed } from './core/pumpPortalCreatorFeed.js';
import { startRuntimeHealthHeartbeat } from './services/runtimeHealthHeartbeat.js';
import { startShadowDecisionOutcomeGrader } from './intelligence/shadowDecisionOutcomeGrader.js';

void startPumpPortalCreatorFeed().catch((error) => {
  console.log('[PumpPortalCreatorFeed] startup error', {
    error: error instanceof Error ? error.message : String(error),
  });
});

startRuntimeHealthHeartbeat();
startShadowDecisionOutcomeGrader();

await import('./main.js');
