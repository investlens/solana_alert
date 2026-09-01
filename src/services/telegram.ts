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

async function sendTelegramRequest(chatId: string, text: string, buttons?: InlineButton[][]): Promise<number | null> {
  if (!chatId) return null;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (buttons?.length) body.reply_markup = { inline_keyboard: buttons };

  if (config.dryRun) {
    console.log(`\n--- MESSAGE TO ${chatId} ---\n${text}\nButtons: ${JSON.stringify(buttons ?? [])}\n---------------------------\n`);
    return null;
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
  const payload = await res.json() as { result?: { message_id?: number } };
  return Number.isFinite(Number(payload.result?.message_id)) ? Number(payload.result?.message_id) : null;
}

export async function sendTelegram(chatId: string, text: string, buttons?: InlineButton[][]): Promise<void> {
  await sendTelegramRequest(chatId, text, buttons);
}

export async function sendTelegramWithMessageId(chatId: string, text: string,
  buttons?: InlineButton[][]): Promise<number | null> {
  return sendTelegramRequest(chatId, text, buttons);
}

export async function editTelegramMessage(chatId: string, messageId: number, text: string,
  buttons?: InlineButton[][]): Promise<void> {
  if (!chatId || !Number.isFinite(messageId)) return;
  if (config.dryRun) {
    console.log(`\n--- EDIT MESSAGE ${messageId} TO ${chatId} ---\n${text}\nButtons: ${JSON.stringify(buttons ?? [])}\n---------------------------\n`);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/editMessageText`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons ?? [] },
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    if (res.status === 400 && bodyText.includes('message is not modified')) return;
    throw new Error(`Telegram edit failed: ${res.status} ${bodyText}`);
  }
}
