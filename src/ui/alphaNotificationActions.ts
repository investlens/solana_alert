import { assertAlphaActions, type AlphaNotificationAction } from './alphaNotification.js';

export type AlphaMarketActionInput = {
  chartUrl?: string | null;
  tokenUrl: string;
  tradeUrl?: string | null;
  trackCallback?: string | null;
  muteCallback?: string | null;
  copyContractCallback?: string | null;
  walletActivityCallback?: string | null;
};

export function buildAlphaMarketActions(input: AlphaMarketActionInput): AlphaNotificationAction[][] {
  const rows: AlphaNotificationAction[][] = [];
  if (input.tradeUrl) rows.push([{ text: '⚡ Trade', url: input.tradeUrl }]);

  const market: AlphaNotificationAction[] = [];
  if (input.chartUrl && input.chartUrl !== input.tokenUrl) {
    market.push({ text: '📊 Chart', url: input.chartUrl });
  }
  market.push({ text: '🔎 Token', url: input.tokenUrl });
  rows.push(market);

  if (input.copyContractCallback) {
    rows.push([{ text: '📋 Copy CA', callback_data: input.copyContractCallback }]);
  }

  const preferences: AlphaNotificationAction[] = [];
  if (input.trackCallback) preferences.push({ text: '👀 Track', callback_data: input.trackCallback });
  if (input.muteCallback) preferences.push({ text: '🔕 Mute', callback_data: input.muteCallback });
  if (preferences.length) rows.push(preferences);
  if (input.walletActivityCallback) {
    rows.push([{ text: '🐋 Wallet Activity', callback_data: input.walletActivityCallback }]);
  }
  return assertAlphaActions(rows);
}
