import { createExplorerJsonReader } from './explorerProviderCooldown.js';
export const robinhoodExplorerJson = createExplorerJsonReader({
  baseUrl: String(process.env.ROBINHOOD_WALLET_EXPLORER_BASE_URL ?? 'https://robinhoodchain.blockscout.com/api/v2').replace(/\/$/, ''),
  timeoutMs: Math.max(2_000, Math.min(15_000, Number(process.env.ROBINHOOD_WALLET_EXPLORER_TIMEOUT_MS ?? 6_000))),
});
