import type { Telegraf } from 'telegraf';
import { requireCapability } from './accessControl.js';
import { getRobinhoodTokenIntelligence } from '../services/tokenIntelligenceService.js';
import { renderTokenIntelligence, tokenIntelligenceButtons } from '../ui/tokenIntelligenceView.js';
import { trackRuntimeToken } from '../services/runtimeTokenTracking.js';
import { getPositionCheck, type PositionSize } from '../services/positionCheckService.js';
import { renderPositionCheck, positionCheckButtons } from '../ui/positionCheckView.js';

const activeReplies = new Set<string>();

export function registerTokenIntelligenceActions(bot: Telegraf<any>) {
  console.log('[PositionCheck] READY sizes=0.001,0.01,0.05 mode=READ_ONLY source=PONS_NATIVE_CURVE_MODEL');
  bot.action(/^PC_RH_(0\.001|0\.01|0\.05)_(0x[a-fA-F0-9]{40})$/, async ctx => {
    if (!await requireCapability(ctx, 'intelligence.investigations', 'POSITION_CHECK')) return;
    await ctx.answerCbQuery('Checking position evidence…').catch(() => {});
    const key = `position:${String(ctx.from?.id ?? '')}`;
    if (activeReplies.has(key)) return;
    activeReplies.add(key);
    try {
      const check = await getPositionCheck(ctx.match[2], ctx.match[1] as PositionSize);
      const options = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: positionCheckButtons(check.token) } };
      const previous = ctx.callbackQuery?.message;
      if (previous && 'text' in previous && previous.text.startsWith('🎯 POSITION CHECK')) {
        await ctx.editMessageText(renderPositionCheck(check), options);
      } else await ctx.reply(renderPositionCheck(check), options);
    } catch {
      await ctx.reply('Position Check is unavailable or busy. Please try again shortly.').catch(() => {});
    } finally { activeReplies.delete(key); }
  });
  bot.action(/^COPY_CA_(0x[a-fA-F0-9]{40})$/, async ctx => {
    const token = String(ctx.match[1]);
    await ctx.answerCbQuery('Contract address ready').catch(() => {});
    await ctx.reply(`<code>${token}</code>`, { parse_mode: 'HTML' }).catch(() => {});
  });

  bot.action(/^BOOST_TRACK_(0x[a-fA-F0-9]{40})$/, async ctx => {
    const userId = String(ctx.from?.id ?? '');
    const token = String(ctx.match[1]);
    const added = trackRuntimeToken(userId, token);
    await ctx.answerCbQuery(added ? 'Tracking enabled' : 'Already tracking').catch(() => {});
    if (added) {
      await ctx.reply(
        `⭐ <b>TRACKING ENABLED</b>\n\nAlphaOS will keep this token in your active runtime watch list.\n<code>${token}</code>`,
        { parse_mode: 'HTML' },
      ).catch(() => {});
    }
  });
  bot.action(/^FI_RH_(0x[a-fA-F0-9]{40})$/, async ctx => {
    if (!await requireCapability(ctx, 'intelligence.investigations', 'TOKEN_INTELLIGENCE')) return;
    await ctx.answerCbQuery('Building token intelligence…').catch(() => {});
    const replyKey = `${String(ctx.from?.id ?? '')}:${String(ctx.match[1]).toLowerCase()}`;
    if (activeReplies.has(replyKey)) return;
    activeReplies.add(replyKey);
    try {
      const intel = await getRobinhoodTokenIntelligence(ctx.match[1]);
      await ctx.reply(renderTokenIntelligence(intel), { parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: tokenIntelligenceButtons(intel) } });
    } catch (error) {
      console.error('[TokenIntel]', { event: 'ANALYSIS_FAILED', token: ctx.match[1],
        reason: error instanceof Error ? error.message : String(error) });
      await ctx.reply('Token intelligence could not be completed. No monitoring, alerts, or trading settings were changed.').catch(() => {});
    } finally { activeReplies.delete(replyKey); }
  });
}
