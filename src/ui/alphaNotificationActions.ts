import { assertAlphaActions, type AlphaNotificationAction } from './alphaNotification.js';

export type AlphaMarketActionInput = {
  chartUrl?: string | null;
  tokenUrl: string;
  tradeUrl?: string | null;
  trackCallback?: string | null;
  muteCallback?: string | null;
  copyContractCallback?: string | null;
  walletActivityCallback?: string | null;
  fullIntelCallback?: string | null;
};

export function buildAlphaMarketActions(input: AlphaMarketActionInput): AlphaNotificationAction[][] {
  const rows: AlphaNotificationAction[][] = [];
  const primary: AlphaNotificationAction[] = [];
  if (input.fullIntelCallback) primary.push({ text: '🔬 Full Intel', callback_data: input.fullIntelCallback });
  if (input.chartUrl && input.chartUrl !== input.tokenUrl) {
    primary.push({ text: '📊 Chart', url: input.chartUrl });
  }
  if (primary.length) rows.push(primary);

  const preferences: AlphaNotificationAction[] = [];
  if (input.trackCallback) preferences.push({ text: '⭐ Track', callback_data: input.trackCallback });
  if (input.copyContractCallback) preferences.push({ text: '📋 Copy CA', callback_data: input.copyContractCallback });
  if (preferences.length) rows.push(preferences);
  if (input.muteCallback) rows.push([{ text: '🔕 Mute', callback_data: input.muteCallback }]);
  rows.push([{ text: '🔎 Token', url: input.tokenUrl }]);
  if (input.tradeUrl) rows.push([{ text: '⚡ Trade', url: input.tradeUrl }]);
  if (input.walletActivityCallback) {
    rows.push([{ text: '🐋 Wallet Activity', callback_data: input.walletActivityCallback }]);
  }
  return assertAlphaActions(rows);
}
