import type { Telegraf } from 'telegraf';
import { config } from '../../config.js';
import { getTerminalStats } from '../../terminal/terminalStats.js';
import { buildTerminalMessage } from '../../terminal/terminalBuilder.js';

function isAdmin(telegramId: string) {
  return telegramId === config.adminTelegramId;
}

function terminalKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: '🔄 Refresh',
          callback_data: 'ADMIN_TERMINAL_REFRESH',
        },
        {
          text: '📚 Memory',
          callback_data: 'ADMIN_TERMINAL_MEMORY',
        },
      ],
      [
        {
          text: '📊 Performance',
          callback_data: 'ADMIN_TERMINAL_PERFORMANCE',
        },
        {
          text: '⚡ API Health',
          callback_data: 'ADMIN_TERMINAL_HEALTH',
        },
      ],
      [
        {
          text: '🤖 Auto Trade',
          callback_data: 'AUTO_TRADE_STATUS',
        },
        {
          text: '⬅️ Main Menu',
          callback_data: 'MAIN_MENU',
        },
      ],
    ],
  };
}

async function renderTerminal(ctx: any) {
  const stats = await getTerminalStats();
  const message = buildTerminalMessage(stats);

  const options = {
    parse_mode: 'HTML' as const,
    reply_markup: terminalKeyboard(),
  };

  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(message, options);
    } else {
      await ctx.reply(message, options);
    }
  } catch {
    await ctx.reply(message, options);
  }
}

export function registerAdminTerminal(bot: Telegraf<any>) {
  bot.command('terminal', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    if (!isAdmin(telegramId)) {
      await ctx.reply('Admin only.');
      return;
    }

    try {
      await renderTerminal(ctx);
    } catch (error) {
      console.error('terminal command error:', error);

      await ctx.reply(
        `❌ Terminal failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  });

  bot.action('ADMIN_TERMINAL_REFRESH', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    await ctx.answerCbQuery('Refreshing AlphaOS Terminal...');

    try {
      await renderTerminal(ctx);
    } catch (error) {
      console.error('terminal refresh error:', error);
      await ctx.reply('❌ Unable to refresh the terminal.');
    }
  });

  bot.action('ADMIN_TERMINAL_MEMORY', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    await ctx.answerCbQuery();

    const stats = await getTerminalStats();

    await ctx.reply(
      [
        '📚 <b>ALPHA MEMORY</b>',
        '━━━━━━━━━━━━━━━━━━',
        '',
        `Tracked Tokens: <b>${stats.tokensTracked}</b>`,
        `Timeline Events: <b>${stats.timelineEvents}</b>`,
        `Alerts Today: <b>${stats.alertsToday}</b>`,
        `BUY Signals Today: <b>${stats.buysToday}</b>`,
        '',
        'Alpha Memory continuously records:',
        '• Alert market state',
        '• Market-cap changes',
        '• Liquidity changes',
        '• Price evolution',
        '• Signal outcomes',
        '',
        'Future creator and wallet scoring will use this history.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '⬅️ Terminal',
                callback_data: 'ADMIN_TERMINAL_REFRESH',
              },
            ],
          ],
        },
      }
    );
  });

  bot.action('ADMIN_TERMINAL_PERFORMANCE', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    await ctx.answerCbQuery();

    const stats = await getTerminalStats();

    await ctx.reply(
      [
        '📊 <b>ALPHAOS PERFORMANCE</b>',
        '━━━━━━━━━━━━━━━━━━',
        '',
        `Alerts Today: <b>${stats.alertsToday}</b>`,
        `BUY Signals Today: <b>${stats.buysToday}</b>`,
        '',
        stats.latestBuy
          ? [
              '🚀 <b>Latest BUY</b>',
              `Token: <b>${stats.latestBuy.symbol}</b>`,
              `Score: <b>${stats.latestBuy.score ?? 'Tracking'}/100</b>`,
              `Market Cap: <b>${
                stats.latestBuy.marketCap != null
                  ? `$${Math.round(stats.latestBuy.marketCap).toLocaleString()}`
                  : 'Tracking'
              }</b>`,
            ].join('\n')
          : 'No BUY signal recorded today.',
        '',
        'Detailed 10m, 30m, 1h and 6h outcome reporting is the next memory upgrade.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '⬅️ Terminal',
                callback_data: 'ADMIN_TERMINAL_REFRESH',
              },
            ],
          ],
        },
      }
    );
  });

  bot.action('ADMIN_TERMINAL_HEALTH', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    await ctx.answerCbQuery();

    const stats = await getTerminalStats();

    await ctx.reply(
      [
        '⚡ <b>API HEALTH</b>',
        '━━━━━━━━━━━━━━━━━━',
        '',
        `DexScreener: <b>${stats.apiStatus.dexScreener}</b>`,
        `Helius: <b>${stats.apiStatus.helius}</b>`,
        `Bitquery: <b>${stats.apiStatus.bitquery}</b>`,
        `Pump.fun: <b>${stats.apiStatus.pumpfun}</b>`,
        '',
        '⚠️ Current status values are based on known service state.',
        'The next upgrade will make these health checks fully live.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '⬅️ Terminal',
                callback_data: 'ADMIN_TERMINAL_REFRESH',
              },
            ],
          ],
        },
      }
    );
  });
}