import { cleanAlertCard, cleanAlertButtons } from '../ui/alertCardLayout.js';
import { buildAlphaosAlertCard } from '../ui/alphaosAlertCard.js';
import { sendAlphaosPhotoAlert, telegramCaptionLength } from '../ui/alphaosPhotoDelivery.js';
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
  text = cleanAlertCard(text);
  if (/<code>/.test(text)) buttons = cleanAlertButtons(buttons);

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

  // Only bounded market cards become photos; interactive screens stay as text.
  // Images exist in memory only. The caption stays within Telegram's limit.
  const category = text.match(/(?:BOOST DETECTED|BOOST INCREASED|MAX BOOST 500\+|ARC OPPORTUNITY|TRADE SETUP WATCH|SUPPLY BURN|SOCIAL MAFIA ALERT)/)?.[0];
  if (category && telegramCaptionLength(text) <= 1024) {
    const ticker = text.match(/<b>\$([A-Za-z_][A-Za-z0-9_]{0,23})\b/)?.[1];
    const identityName = text.match(/<b>\$[^<]+<\/b> · ([^\n]+)/)?.[1];
    const name = identityName?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const image = await buildAlphaosAlertCard({ symbol: ticker, name, category,
      chainLabel: /ARC OPPORTUNITY/.test(category) ? 'ARC' : 'ALPHAOS / TOKEN RESEARCH',
      badge: 'INFORMATION / DYOR', footer: 'Promotion and market activity do not establish token safety.' }).catch(() => null);
    return (await sendAlphaosPhotoAlert({ botToken: config.botToken, chatId, text,
      keyboard: buttons ?? [], image })).messageId;
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
  text = cleanAlertCard(text);
  if (/<code>/.test(text)) buttons = cleanAlertButtons(buttons);
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
    if (res.status === 400 && /there is no text in the message/i.test(bodyText)) {
      const caption = await fetch(`https://api.telegram.org/bot${config.botToken}/editMessageCaption`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, caption: text, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons ?? [] } }),
      });
      if (caption.ok) return;
      const error = await caption.text().catch(() => '');
      if (caption.status === 400 && error.includes('message is not modified')) return;
      throw new Error(`Telegram caption edit failed: ${caption.status}`);
    }
    throw new Error(`Telegram edit failed: ${res.status} ${bodyText}`);
  }
}
