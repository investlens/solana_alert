import { robinhoodExplorerAccess } from './explorerAccessConfig.js';
import { createExplorerJsonReader } from './explorerProviderCooldown.js';
export const robinhoodExplorerJson = createExplorerJsonReader({
  ...robinhoodExplorerAccess(process.env),
  timeoutMs: Math.max(2_000, Math.min(15_000, Number(process.env.ROBINHOOD_WALLET_EXPLORER_TIMEOUT_MS ?? 6_000))),
});
