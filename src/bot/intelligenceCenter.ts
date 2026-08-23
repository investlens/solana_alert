import { Markup, type Telegraf } from 'telegraf';
import { escapeTelegramHtml } from '../ui/escapeHtml.js';
import { strategyDisplay } from '../product/strategyPresentation.js';
import {
  getCreatorLeaders,
  getPerformanceLeaders,
  getRecentInvestigations,
  getSmartMoneyLeaders,
} from '../services/intelligenceService.js';
import { getContextAccess, requireCapability } from './accessControl.js';
import { intelligenceMenu, backHome } from './menus.js';
import {
  creatorSummary,
  formatPercentage,
  smartMoneyHistory,
  smartMoneySummary,
} from '../product/intelligenceCredibility.js';

function compact(value: unknown) {
  const text = String(value ?? '');
  return text.length <= 15 ? text : `${text.slice(0, 7)}…${text.slice(-5)}`;
}

function number(value: unknown, digits = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '-';
}

async function editOrReply(ctx: any, text: string, replyMarkup: any) {
  const options = { parse_mode: 'HTML' as const, reply_markup: replyMarkup };
  try {
    await ctx.editMessageText(text, options);
  } catch (error) {
    if (String(error).toLowerCase().includes('message is not modified')) return;
    await ctx.reply(text, options);
  }
}

export async function renderIntelligenceHome(ctx: any) {
  const access = await getContextAccess(ctx);
  await editOrReply(
    ctx,
    [
      '🧠 <b>INTELLIGENCE</b>',
      '',
      'Understand what is moving, who is involved, and how prior calls performed.',
      '',
      access.tier === 'free'
        ? 'Free access includes a limited view of current investigations.'
        : 'Your access includes the full Intelligence workspace.',
    ].join('\n'),
    intelligenceMenu(access).reply_markup,
  );
}

export async function renderPerformanceScreen(ctx: any) {
  const performance = await getPerformanceLeaders();
  const rows = performance.leaders;
  const lines = [
    '📊 <b>PERFORMANCE</b>',
    '',
    'Recorded peak and latest observed outcomes from tracked calls.',
    '',
  ];
  if (!rows.length) lines.push('No verified performance records are available yet.');
  for (const row of rows as any[]) {
    lines.push(
      `<b>${escapeTelegramHtml(row.symbol ?? compact(row.token))}</b>`,
      `Peak ${formatPercentage(row.performance.peakRoi)} · Last observed ${formatPercentage(row.performance.currentRoi)}`,
      row.performance.stale ? 'Observation is stale' : 'Observation is current',
      '',
    );
  }
  if (performance.reviewCount > 0) {
    lines.push(`${performance.reviewCount} historical record${performance.reviewCount === 1 ? '' : 's'} withheld pending source-data verification.`);
  }
  if (performance.unavailableCount > 0) {
    lines.push(`${performance.unavailableCount} record${performance.unavailableCount === 1 ? '' : 's'} unavailable because required prices are missing or invalid.`);
  }
  await editOrReply(ctx, lines.join('\n'), backHome('Intelligence', 'INTELLIGENCE_CENTER').reply_markup);
}

export function registerIntelligenceCenter(bot: Telegraf<any>) {
  bot.action('INTELLIGENCE_CENTER', async ctx => {
    await ctx.answerCbQuery();
    await renderIntelligenceHome(ctx);
  });

  bot.action('INTEL_INVESTIGATIONS', async ctx => {
    const access = await requireCapability(ctx, 'intelligence.investigations', 'INTELLIGENCE_CENTER');
    if (!access) return;
    await ctx.answerCbQuery();

    try {
      const rows = await getRecentInvestigations(access.tier === 'free' ? 3 : 8);
      const lines = ['🔎 <b>INVESTIGATIONS</b>', '', 'Current evidence-backed market theses.', ''];
      if (!rows.length) lines.push('No active investigations right now.');
      for (const row of rows as any[]) {
        const strategy = strategyDisplay(row.strategy_key);
        lines.push(
          `<b>${escapeTelegramHtml(row.title ?? compact(row.asset_id))}</b>`,
          `${escapeTelegramHtml(strategy.name)} · ${escapeTelegramHtml(String(row.recommended_action ?? 'WATCH').replace(/_/g, ' '))}`,
          `${Math.round(Number(row.confidence ?? 0))}/100 confidence`,
          '',
        );
      }
      const buttons = rows.slice(0, 6).map((row: any) => [
        Markup.button.callback(`Open ${compact(row.asset_id)}`, `OPP_VIEW_${row.id}`),
      ]);
      buttons.push(backHome('Intelligence', 'INTELLIGENCE_CENTER').reply_markup.inline_keyboard[0] as any);
      await editOrReply(ctx, lines.join('\n'), Markup.inlineKeyboard(buttons).reply_markup);
    } catch (error) {
      console.error('[Intelligence] Investigations failed:', error);
      await ctx.reply('Unable to load investigations. Please try again.', backHome('Intelligence', 'INTELLIGENCE_CENTER'));
    }
  });

  bot.action('INTEL_SMART_MONEY', async ctx => {
    if (!await requireCapability(ctx, 'intelligence.smartMoney', 'INTELLIGENCE_CENTER')) return;
    await ctx.answerCbQuery();
    try {
      const rows = await getSmartMoneyLeaders();
      const lines = ['🐋 <b>SMART MONEY</b>', '', 'Tracked wallets ranked by measured history.', ''];
      if (!rows.length) lines.push('No scored smart-money wallets are available yet.');
      for (const row of rows as any[]) {
        const history = smartMoneyHistory(row.completed_trades);
        lines.push(
          `<b>${history.maturity}</b> · ${escapeTelegramHtml(compact(row.wallet))}`,
          smartMoneySummary({
            completedTrades: row.completed_trades,
            totalBuys: row.total_buys,
            winRate: row.win_rate,
          }),
          '',
        );
      }
      await editOrReply(ctx, lines.join('\n'), backHome('Intelligence', 'INTELLIGENCE_CENTER').reply_markup);
    } catch (error) {
      console.error('[Intelligence] Smart Money failed:', error);
      await ctx.reply('Unable to load Smart Money. Please try again.', backHome('Intelligence', 'INTELLIGENCE_CENTER'));
    }
  });

  bot.action('INTEL_CREATORS', async ctx => {
    if (!await requireCapability(ctx, 'intelligence.creators', 'INTELLIGENCE_CENTER')) return;
    await ctx.answerCbQuery();
    try {
      const rows = await getCreatorLeaders();
      const lines = ['👤 <b>CREATORS</b>', '', 'Observed launches and classified outcome history.', ''];
      if (!rows.length) lines.push('No scored creator history is available yet.');
      for (const row of rows as any[]) {
        const summary = creatorSummary({
          totalLaunches: row.total_launches,
          successfulLaunches: row.successful_launches,
          failedLaunches: row.failed_launches,
        });
        lines.push(
          `<b>${escapeTelegramHtml(compact(row.creator_wallet))}</b> · ${escapeTelegramHtml(String(row.chain ?? 'solana'))}`,
          ...summary,
          '',
        );
      }
      await editOrReply(ctx, lines.join('\n'), backHome('Intelligence', 'INTELLIGENCE_CENTER').reply_markup);
    } catch (error) {
      console.error('[Intelligence] Creators failed:', error);
      await ctx.reply('Unable to load Creators. Please try again.', backHome('Intelligence', 'INTELLIGENCE_CENTER'));
    }
  });

  bot.action('INTEL_PERFORMANCE', async ctx => {
    if (!await requireCapability(ctx, 'intelligence.performance', 'INTELLIGENCE_CENTER')) return;
    await ctx.answerCbQuery();
    try {
      await renderPerformanceScreen(ctx);
    } catch (error) {
      console.error('[Intelligence] Performance failed:', error);
      await ctx.reply('Unable to load Performance. Please try again.', backHome('Intelligence', 'INTELLIGENCE_CENTER'));
    }
  });
}
