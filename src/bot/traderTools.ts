import type { Telegraf } from 'telegraf';
import { requireCapability, getContextAccess } from './accessControl.js';
import { hasCapability } from '../product/capabilities.js';
import { getTradeReadiness } from '../services/tradeReadiness.js';
import { personalMonitors, startDeteriorationMonitor, stopDeteriorationMonitor, startDeteriorationWorker } from '../services/deteriorationMonitor.js';
import { renderReadiness, readinessButtons, renderDeterioration } from '../ui/tradeReadinessView.js';
import { sendTelegramWithMessageId } from '../services/telegram.js';
const busy = new Set<string>();
export function registerTraderTools(bot: Telegraf<any>) {
  startDeteriorationWorker(async (user, row, market, mask) => {
    const access = await getContextAccess({ from: { id: user } });
    if (!hasCapability(access, 'monitoring.personal')) { await stopDeteriorationMonitor(user, row.token); return; }
    await sendTelegramWithMessageId(user, renderDeterioration(row, market, mask), [
      [{ text: '↻ Readiness', callback_data: `TR_RH_${row.token}` }, { text: 'Stop Monitor', callback_data: `DS_RH_${row.token}` }],
    ]);
  });
  bot.action(/^(TR|DM|DS)_RH_(0x[a-fA-F0-9]{40})$/, async ctx => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Open AlphaOS in private chat for personal trader tools.', { show_alert: true }); return;
    }
    const action = ctx.match[1]; const token = ctx.match[2].toLowerCase(); const user = String(ctx.from?.id ?? '');
    if (!await requireCapability(ctx, action === 'TR' ? 'trade.readiness' : 'monitoring.personal')) return;
    await ctx.answerCbQuery('Loading trader tools…').catch(() => {});
    if (busy.has(user)) return;
    busy.add(user);
    try {
      if (action === 'DS') {
        await stopDeteriorationMonitor(user, token);
        await ctx.reply('Monitoring stopped for this token.', { reply_markup: { inline_keyboard: [[{ text: 'My Monitors', callback_data: 'DM_HOME' }]] } }); return;
      }
      const result = await getTradeReadiness(token);
      if (action === 'DM') {
        if (!result.market) { await ctx.reply('Monitoring could not start: a fresh indexed Robinchain USD price and pool liquidity are required.'); return; }
        const started = await startDeteriorationMonitor(user, result.market);
        await ctx.reply(started.status === 'ACTIVE' && started.row
          ? `🔔 Personal monitoring active until ${new Date(started.row.expires).toISOString().slice(11, 19)} UTC.\nBaseline starts at ${new Date(started.row.at).toISOString().slice(11, 19)} UTC, not at the original alert.\nAbout 2-minute checks · Price −15% / LP −20% · Maximum 3 warning events.\nNot continuous protection; fast declines may happen between checks.`
          : 'Monitoring capacity reached: maximum 2 tokens per user, 10 tokens overall and 10 subscribers per token. Stop a monitor or retry after expiry.',
          { reply_markup: { inline_keyboard: [[{ text: 'My Monitors', callback_data: 'DM_HOME' }, { text: 'Stop Monitor', callback_data: `DS_RH_${token}` }]] } });
        return;
      }
      await ctx.reply(renderReadiness(token, result), { parse_mode: 'HTML', link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: readinessButtons(token, Boolean(result.market)) } });
    } catch {
      await ctx.reply('Trader tools are busy or shared monitoring is unavailable. No new monitoring was confirmed; check My Monitors before retrying.').catch(() => {});
    } finally { busy.delete(user); }
  });
  bot.action('DM_HOME', async ctx => {
    if (ctx.chat?.type !== 'private') { await ctx.answerCbQuery('Use private chat for personal monitors.'); return; }
    if (!await requireCapability(ctx, 'monitoring.personal')) return;
    await ctx.answerCbQuery().catch(() => {});
    try {
      const rows = await personalMonitors(String(ctx.from?.id ?? ''));
      const list = Array.isArray(rows) ? rows : [];
      await ctx.reply(['🔔 PERSONAL MONITORS · PRO', '',
        ...(list.length ? list.map(row => `${row.symbol || row.token.slice(0, 10)} · expires ${new Date(row.expires).toISOString().slice(11, 19)} UTC\n${row.token}`) : ['No active monitors. Open Readiness on a Robinchain token and tap Monitor 1h.']), '',
        '2 tokens/user · 10 tokens overall · Automatic 1-hour expiry.', 'Research monitoring; no automatic trades.'].join('\n'),
        { reply_markup: { inline_keyboard: [
          ...list.map(row => [{ text: 'Readiness', callback_data: `TR_RH_${row.token}` }, { text: 'Stop', callback_data: `DS_RH_${row.token}` }]),
          [{ text: 'Free / Pro', callback_data: 'FEATURE_GUIDE' }, { text: 'Home', callback_data: 'MAIN_MENU' }],
        ] } });
    } catch { await ctx.reply('Monitoring status unavailable. Please try again shortly.'); }
  });
}
