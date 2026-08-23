import { config } from '../config.js';

export type InlineButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

export type AlphaAlertLinks = {
  tokenMint?: string | null;
  reportUrl?: string | null;
  chartUrl?: string | null;
  buyUrl?: string | null;
  pumpfunUrl?: string | null;
};

function safeUrl(value?: string | null): string | null {
  const url = String(value ?? '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  return url;
}

export function buildAlphaAlertButtons(links: AlphaAlertLinks): InlineButton[][] {
  const rows: InlineButton[][] = [];
  const report = safeUrl(links.reportUrl);
  const chart = safeUrl(links.chartUrl);
  const buy = safeUrl(links.buyUrl);
  const pump = safeUrl(links.pumpfunUrl) || (links.tokenMint ? `https://pump.fun/${links.tokenMint}` : null);

  if (report) rows.push([{ text: '🔍 Open AI Investigation', url: report }]);

  const marketRow: InlineButton[] = [];
  if (chart) marketRow.push({ text: '📈 Live Chart', url: chart });
  if (pump) marketRow.push({ text: '🚀 Pump.fun', url: pump });
  if (marketRow.length) rows.push(marketRow);

  if (buy) rows.push([{ text: '⚡ Open Trading Route', url: buy }]);
  return rows;
}

export function buildAlphaReportUrl(tokenMint: string, context?: { engine?: string; event?: string }): string | null {
  const base = String(process.env.ALPHAOS_WEB_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!base || !tokenMint) return null;
  const params = new URLSearchParams({ source: 'telegram' });
  if (context?.engine) params.set('engine', context.engine);
  if (context?.event) params.set('event', context.event);
  return `${base}/report/${encodeURIComponent(tokenMint)}?${params.toString()}`;
}

export async function sendTelegram(chatId: string, text: string, buttons?: InlineButton[][]) {
  if (!chatId) return;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (buttons?.length) body.reply_markup = { inline_keyboard: buttons };

  if (config.dryRun) {
    console.log(`\n--- MESSAGE TO ${chatId} ---\n${text}\nButtons: ${JSON.stringify(buttons ?? [])}\n---------------------------\n`);
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Telegram send failed: ${res.status} ${bodyText}`);
  }
}
