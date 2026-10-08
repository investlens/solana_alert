import { cleanAlertCard, cleanAlertButtons, type CardButton } from './alertCardLayout.js';
import { withResearchDisclosure } from './researchDisclosure.js';
// Telegram counts caption characters after HTML entities have been parsed.
export function telegramCaptionLength(text: string): number {
  return text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string,string> = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
    if (named[entity]) return named[entity];
    const hex = /^&#x/i.test(entity);
    const value = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  }).length;
}
export function telegramRecipientUnavailable(error: unknown): boolean {
  const reason = error instanceof Error ? error.message : String(error);
  return /(?:403\b|chat not found|bot was blocked|user is deactivated|bot can't initiate conversation)/i.test(reason);
}
function rejection(status: number, payload: { error_code?: number; description?: string } | null): Error {
  const description = String(payload?.description ?? 'response did not confirm delivery').slice(0, 500);
  return new Error(`Telegram delivery rejected: ${payload?.error_code ?? status} ${description}`);
}
export type AlphaosDelivery = { messageId: number; photo: boolean };
export async function sendAlphaosPhotoAlert(args: {
  botToken: string; chatId: string; text: string; keyboard: unknown; image: Buffer | null;
}, request: typeof fetch = fetch): Promise<AlphaosDelivery> {
  args = {...args, text: withResearchDisclosure(cleanAlertCard(args.text))};
  if (Array.isArray(args.keyboard)) args.keyboard = cleanAlertButtons(args.keyboard as CardButton[][], args.text);
  const base = `https://api.telegram.org/bot${args.botToken}`;
  if (args.image && telegramCaptionLength(args.text) <= 1024) {
    const form = new FormData();
    form.set('chat_id', args.chatId); form.set('caption', args.text); form.set('parse_mode', 'HTML');
    form.set('reply_markup', JSON.stringify({ inline_keyboard: args.keyboard }));
    form.set('photo', new Blob([new Uint8Array(args.image)], { type: 'image/png' }), 'alphaos-alert.png');
    const response = await request(`${base}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(8_000) });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error_code?: number; description?: string; result?: { message_id?: number } } | null;
    if (response.ok && payload?.ok && Number.isInteger(payload.result?.message_id))
      return { messageId: payload!.result!.message_id!, photo: true };
    if (telegramRecipientUnavailable(rejection(response.status, payload))) throw rejection(response.status, payload);
    // Fallback only on an explicit rejection, never an ambiguous timeout/5xx.
    if (!(response.status >= 400 && response.status < 500 && response.status !== 429)
      && !(response.ok && payload?.ok === false)) throw new Error('Telegram photo delivery not confirmed');
    console.warn('[AlphaosCard] photo rejected; sending text fallback');
  }
  const response = await request(`${base}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5_000), body: JSON.stringify({ chat_id: args.chatId, text: args.text, parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup: { inline_keyboard: args.keyboard } }) });
  const payload = await response.json() as { ok?: boolean; error_code?: number; description?: string; result?: { message_id?: number } };
  if (!response.ok || !payload.ok || !Number.isInteger(payload.result?.message_id)) throw rejection(response.status, payload);
  return { messageId: payload.result!.message_id!, photo: false };
}

export function alphaosEnrichmentEdit(delivery: AlphaosDelivery, chatId: string, text: string, keyboard: unknown) {
  text = withResearchDisclosure(cleanAlertCard(text));
  if (Array.isArray(keyboard)) keyboard = cleanAlertButtons(keyboard as CardButton[][], text);
  return { method: delivery.photo ? 'editMessageCaption' : 'editMessageText', body: {
    chat_id: chatId, message_id: delivery.messageId, ...(delivery.photo ? { caption: text } : { text, disable_web_page_preview: true }),
    parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard },
  } };
}
