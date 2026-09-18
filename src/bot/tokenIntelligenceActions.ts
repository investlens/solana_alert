import type { Telegraf } from 'telegraf';
import { requireCapability } from './accessControl.js';
import { getRobinhoodTokenIntelligence } from '../services/tokenIntelligenceService.js';
import { renderTokenIntelligence, tokenIntelligenceButtons } from '../ui/tokenIntelligenceView.js';
import { trackRuntimeToken } from '../services/runtimeTokenTracking.js';

const activeReplies = new Set<string>();

export function registerTokenIntelligenceActions(bot: Telegraf<any>) {
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
