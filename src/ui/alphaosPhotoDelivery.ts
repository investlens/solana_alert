export type AlphaosDelivery = { messageId: number; photo: boolean };
export async function sendAlphaosPhotoAlert(args: {
  botToken: string; chatId: string; text: string; keyboard: unknown; image: Buffer | null;
}, request: typeof fetch = fetch): Promise<AlphaosDelivery> {
  const base = `https://api.telegram.org/bot${args.botToken}`;
  if (args.image) {
    const form = new FormData();
    form.set('chat_id', args.chatId); form.set('caption', args.text); form.set('parse_mode', 'HTML');
    form.set('reply_markup', JSON.stringify({ inline_keyboard: args.keyboard }));
    form.set('photo', new Blob([new Uint8Array(args.image)], { type: 'image/png' }), 'alphaos-alert.png');
    const response = await request(`${base}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(8_000) });
    const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number } } | null;
    if (response.ok && payload?.ok && Number.isInteger(payload.result?.message_id))
      return { messageId: payload!.result!.message_id!, photo: true };
    // Fallback only on an explicit rejection, never an ambiguous timeout/5xx.
    if (!(response.status >= 400 && response.status < 500 && response.status !== 429)
      && !(response.ok && payload?.ok === false)) throw new Error('Telegram photo delivery not confirmed');
    console.warn('[AlphaosCard] photo rejected; sending text fallback');
  }
  const response = await request(`${base}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5_000), body: JSON.stringify({ chat_id: args.chatId, text: args.text, parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup: { inline_keyboard: args.keyboard } }) });
  const payload = await response.json() as { ok?: boolean; result?: { message_id?: number } };
  if (!response.ok || !payload.ok || !Number.isInteger(payload.result?.message_id)) throw new Error('Telegram delivery rejected');
  return { messageId: payload.result!.message_id!, photo: false };
}

export function alphaosEnrichmentEdit(delivery: AlphaosDelivery, chatId: string, text: string, keyboard: unknown) {
  return { method: delivery.photo ? 'editMessageCaption' : 'editMessageText', body: {
    chat_id: chatId, message_id: delivery.messageId, ...(delivery.photo ? { caption: text } : { text, disable_web_page_preview: true }),
    parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard },
  } };
}
