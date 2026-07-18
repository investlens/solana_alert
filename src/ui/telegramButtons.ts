import type { Investigation } from '../models/investigation.js';

type TelegramButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

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

  const primaryRow: TelegramButton[] = [];

  if (validUrl(investigation.links.reportUrl)) {
    primaryRow.push({
      text: '🧠 AI Report',
      url: investigation.links.reportUrl,
    });
  }

  primaryRow.push({
    text: '📈 Chart',
    url: investigation.links.chartUrl,
  });

  rows.push(primaryRow);

  rows.push([
    {
      text: '🟢 Buy',
      url: investigation.links.buyUrl,
    },
  ]);

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
        text: '⚡ Buy 0.03 SOL',
        callback_data: `ADMIN_BUY_SMALL_${investigation.token.address}`,
      },
      {
        text: '🔥 Buy 0.05 SOL',
        callback_data: `ADMIN_BUY_DEFAULT_${investigation.token.address}`,
      },
    ]);

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

  return rows;
}
