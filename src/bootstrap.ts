import { ensurePumpfunHeliusCreatorFallbackStarted } from './core/pumpfunHeliusCreatorFallback.js';

await ensurePumpfunHeliusCreatorFallbackStarted();
await import('./main.js');
