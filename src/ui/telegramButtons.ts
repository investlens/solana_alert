import type { Investigation } from '../models/investigation.js';
import { assertAlphaActions, type AlphaNotificationAction } from './alphaNotification.js';
import { buildAlphaMarketActions } from './alphaNotificationActions.js';

type TelegramButton = AlphaNotificationAction;

type BuildTelegramButtonsOptions = {
  isAdmin: boolean;
};

function validUrl(value?: string): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function buildTelegramButtons(
  investigation: Investigation,
  options: BuildTelegramButtonsOptions
): TelegramButton[][] {
  const rows: TelegramButton[][] = [];
  const marketRows = buildAlphaMarketActions({
    chartUrl: investigation.links.chartUrl,
    tokenUrl: `https://solscan.io/token/${encodeURIComponent(investigation.token.address)}`,
  });

  if (options.isAdmin) {
    rows.push([{
      text: '⚡ Trade',
      callback_data: `ADMIN_BUY_DEFAULT_${investigation.token.address}`,
    }]);
  } else if (validUrl(investigation.links.buyUrl)) {
    rows.push([{ text: '⚡ Trade', url: investigation.links.buyUrl }]);
  }
  rows.push(...marketRows);

  if (validUrl(investigation.links.reportUrl)) {
    rows.push([{ text: '🧠 Analyze', url: investigation.links.reportUrl }]);
  }

  const socialButtons: TelegramButton[] = [];

  if (validUrl(investigation.links.websiteUrl)) {
    socialButtons.push({
      text: '🌐 Website',
      url: investigation.links.websiteUrl,
    });
  }

  if (validUrl(investigation.links.xUrl)) {
    socialButtons.push({
      text: '𝕏 X',
      url: investigation.links.xUrl,
    });
  }

  if (validUrl(investigation.links.telegramUrl)) {
    socialButtons.push({
      text: '💬 Telegram',
      url: investigation.links.telegramUrl,
    });
  }

  for (let i = 0; i < socialButtons.length; i += 2) {
    rows.push(socialButtons.slice(i, i + 2));
  }

  if (options.isAdmin) {
    rows.push([
      {
        text: '⏸ Pause Auto',
        callback_data: 'PAUSE_AUTO_TRADE',
      },
      {
        text: '📊 Auto Status',
        callback_data: 'AUTO_TRADE_STATUS',
      },
    ]);
  }

  return assertAlphaActions(rows);
}
