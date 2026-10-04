import { cleanAlertCard } from '../ui/alertCardLayout.js';
import { telegramCaptionLength } from '../ui/alphaosPhotoDelivery.js';
export async function deliverResearchCard(ctx: any, args: {
  image: Buffer | null; caption: string; keyboard: unknown; refresh: boolean;
}): Promise<void> {
  args = {...args, caption: cleanAlertCard(args.caption)};
  const options = {parse_mode:'HTML', reply_markup:args.keyboard};
  const asText = !args.image || telegramCaptionLength(args.caption) > 1024;
  if (args.refresh) {
    const message = ctx.callbackQuery?.message;
    if (message && !message.photo) { await ctx.editMessageText(args.caption, options); return; }
    if (asText) {
      if (message?.photo && telegramCaptionLength(args.caption) <= 1024) await ctx.editMessageCaption(args.caption, options);
      else await ctx.reply(args.caption, options);
      return;
    }
    await ctx.editMessageMedia({type:'photo',media:{source:args.image},caption:args.caption,parse_mode:'HTML'}, {reply_markup:args.keyboard});
    return;
  }
  const replyOptions = {...options, ...(ctx.message?.message_id ? {reply_parameters:{message_id:ctx.message.message_id}} : {})};
  if (asText) { await ctx.reply(args.caption, replyOptions); return; }
  try { await ctx.replyWithPhoto({source:args.image}, {...replyOptions,caption:args.caption}); }
  catch (error) {
    const value = error as {response?:{error_code?:number;description?:string}};
    // Only an explicit Telegram rejection permits retry as text. Timeouts/5xx
    // are ambiguous: retrying could duplicate a report that Telegram accepted.
    if (value.response?.error_code === 400 && /caption is too long|photo_invalid|image_process_failed|wrong file identifier|failed to process/i.test(value.response.description ?? '')) {
      await ctx.reply(args.caption, replyOptions); return;
    }
    throw error;
  }
}
export function researchErrorSummary(error: unknown): string {
  const e = error as {response?:{description?:string};message?:string};
  return String(e?.response?.description ?? e?.message ?? 'Unknown research failure')
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g,'[redacted]').slice(0,180);
}
