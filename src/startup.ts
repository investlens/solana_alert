import { startPumpPortalCreatorFeed } from './core/pumpPortalCreatorFeed.js';

void startPumpPortalCreatorFeed().catch((error) => {
  console.log('[PumpPortalCreatorFeed] startup error', {
    error: error instanceof Error ? error.message : String(error),
  });
});

await import('./main.js');
