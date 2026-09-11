import { startPumpPortalCreatorFeed } from './core/pumpPortalCreatorFeed.js';
import { startRuntimeHealthHeartbeat } from './services/runtimeHealthHeartbeat.js';

void startPumpPortalCreatorFeed().catch((error) => {
  console.log('[PumpPortalCreatorFeed] startup error', {
    error: error instanceof Error ? error.message : String(error),
  });
});

startRuntimeHealthHeartbeat();

await import('./main.js');
