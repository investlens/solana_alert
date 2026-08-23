import { Markup, Telegraf } from 'telegraf';
import { config } from '../config.js';
import { getTradeLearningSummary } from '../core/tradeLearning.js';
import { registerAdminTerminal } from './admin/terminal.js';
import {
  getAdminWalletAddress,
  getAdminWalletBalance,
} from '../services/wallet.js';
import { adminBuyToken, adminSellTokenPercentWithRetry } from '../core/adminTrading.js';
import {
  getAutoTradeStats,
  manualCloseAutoTrade,
  pauseAutoTrade,
  resumeAutoTrade,
  isAutoTradePaused,
} from '../core/autoTradeManager.js';
import {
 fetchSignalsByType,
 fetchLatestStoredSignals,
 fetchBestStoredSignals
} from '../storage/signalStore.js';
import {
  approveLatestPendingPayment,
  createPendingPayment,
  getPendingPayments,
  getUserByTelegramId,
  getUserCounts,
  rejectLatestPendingPayment,
  txHashExists,
  upsertUser,
} from '../core/subscriptions.js';
import type { PendingUpgradeSession } from '../types/bot.js';
import {
  backToMainMenu,
  mainAlphaMenu,
  alphaFeedMenu,
  tradeTerminalMenu,
} from './menus.js';

const upgradeSessions = new Map<string, PendingUpgradeSession>();

function isAdmin(telegramId: string) {
  return telegramId === config.adminTelegramId;
}

function formatDate(value?: string | null) {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString('en-IN', { hour12: true });
}

async function renderScreen(ctx: any, text: string, options: any) {
  try {
    await ctx.editMessageText(text, options);
  } catch {
    await ctx.reply(text, options);
  }
}

async function sendMainMenu(
  ctx: any,
) {
  const telegramId =
    String(
      ctx.from?.id ??
      '',
    );

  const user =
    await getUserByTelegramId(
      telegramId,
    );

  const tier =
    String(
      user?.tier ??
      'free',
    ).toUpperCase();

  const role =
    tier ===
    'ADMIN'
      ? '👑 ADMIN'
      : tier ===
        'PAID'
        ? '⭐ PRO'
        : '⚪ FREE';

  await renderScreen(
    ctx,
    [
      '🧠 <b>ALPHAOS</b>',
      `${role}`,
      '',
      '<b>Live crypto intelligence</b>',
      'Opportunities · Wallets · Risk · Research',
      '',
      '⚡ <b>Opportunities</b> — what needs attention now',
      '🐋 <b>Wallets</b> — tracked-wallet activity',
      '🎯 <b>Strategies</b> — choose what AlphaOS monitors',
      '',
      '<i>Evidence before execution.</i>',
    ].join(
      '\n',
    ),
    {
      parse_mode:
        'HTML',

      reply_markup:
        mainAlphaMenu()
          .reply_markup,
    },
  );
}

async function sendFirstRunWelcome(
  ctx: any,
) {
  const firstName =
    String(
      ctx.from?.first_name ??
      '',
    ).trim();

  await ctx.reply(
    [
      '🧠 <b>WELCOME TO ALPHAOS</b>',
      '',
      firstName
        ? `Hi ${firstName} 👋`
        : 'Welcome 👋',
      '',
      'AlphaOS watches the market continuously and surfaces what actually needs your attention.',
      '',
      '⚡ Opportunities',
      '🐋 Smart-wallet activity',
      '👨‍💻 Developer behaviour',
      '📈 Momentum & market risk',
      '',
      '<b>You control what gets monitored.</b>',
      '',
      '<i>No noise. Evidence before execution.</i>',
    ].join(
      '\n',
    ),
    {
      parse_mode:
        'HTML',

      reply_markup:
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '🚀 Set Up AlphaOS',
              'ONBOARD_START',
            ),
          ],
          [
            Markup.button.callback(
              '👀 Explore First',
              'MAIN_MENU',
            ),
          ],
        ]).reply_markup,
    },
  );
}

async function sendQuickSetup(
  ctx: any,
) {
  await renderScreen(
    ctx,
    [
      '🚀 <b>QUICK SETUP</b>',
      '',
      'AlphaOS is ready.',
      'Choose what you want to configure first.',
      '',
      '🎯 <b>Strategies</b>',
      'Turn intelligence engines ON or OFF.',
      '',
      '🐋 <b>Wallets</b>',
      'Track public wallets and receive activity alerts.',
      '',
      'You can change everything later from Controls.',
    ].join(
      '\n',
    ),
    {
      parse_mode:
        'HTML',

      reply_markup:
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '🎯 Choose Strategies',
              'STRATEGY_SETTINGS',
            ),
          ],
          [
            Markup.button.callback(
              '🐋 Track a Wallet',
              'WALLET_TRACKING',
            ),
          ],
          [
            Markup.button.callback(
              '✅ Open AlphaOS',
              'MAIN_MENU',
            ),
          ],
        ]).reply_markup,
    },
  );
}

export function registerBotCommands(bot: Telegraf<any>) {
  registerAdminTerminal(bot);
  bot.start(async (ctx) => {
    const telegramId =
      String(
        ctx.from?.id ??
        '',
      );

    const username =
      ctx.from?.username;

    const firstName =
      ctx.from?.first_name;

    /*
     * Read before upsert so AlphaOS can distinguish
     * a genuine first visit from a returning user.
     */
    const existingUser =
      await getUserByTelegramId(
        telegramId,
      );

    await upsertUser({
      telegramId,
      username,
      firstName,
    });

    if (!existingUser) {
      await sendFirstRunWelcome(
        ctx,
      );

      return;
    }

    await sendMainMenu(
      ctx,
    );
  });

  bot.action('MAIN_MENU', async (ctx) => {
    await ctx.answerCbQuery();
    await sendMainMenu(ctx);
  });


  bot.action(
    'ONBOARD_START',
    async ctx => {
      await ctx.answerCbQuery();

      await sendQuickSetup(
        ctx,
      );
    },
  );

  bot.action(
    'INTRO',
    async ctx => {
      await ctx.answerCbQuery();

      await sendFirstRunWelcome(
        ctx,
      );
    },
  );

 bot.action('ALPHA_FEED', async (ctx) => {
  await ctx.answerCbQuery();

  await renderScreen(ctx,
    [
      '🧠 <b>ALPHAOS RESEARCH</b>',
      '━━━━━━━━━━━━━━━━',
      '',
      '<b>AI-ranked institutional opportunities.</b>',
      '',
      '🧠 AI Investigations — strongest current calls',
      '🐋 Whale Radar — smart wallet activity',
      '👤 Creator Intelligence — launch reputation',
      '📈 Performance Archive — tracked performance',
      '',
      'Choose a module:',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: alphaFeedMenu().reply_markup,
    }
  );
});

bot.command('wallet', async (ctx) => {
  const telegramId = String(ctx.from?.id ?? '');

  if (!isAdmin(telegramId)) {
    await ctx.reply('Admin only.');
    return;
  }

  try {
    const address = getAdminWalletAddress();
    const balance = await getAdminWalletBalance();

    await ctx.reply(
      [
        '💰 <b>Admin Wallet</b>',
        '',
        `Address: <code>${address}</code>`,
        `Balance: <b>${balance.toFixed(4)} SOL</b>`,
        '',
        'Funds are used for auto trades.',
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    await ctx.reply(
      `❌ Failed to fetch wallet: ${
        err instanceof Error ? err.message : 'Unknown error'
      }`
    );
  }
});

bot.action('LEARNING_SUMMARY', async (ctx) => {
  const telegramId = String(ctx.from?.id ?? '');
  if (!isAdmin(telegramId)) return ctx.answerCbQuery('Admin only');

  await ctx.answerCbQuery();

  const summary = await getTradeLearningSummary();

  await ctx.reply(
    [
      '🧠 <b>Learning Summary</b>',
      '━━━━━━━━━━━━━━━━',
      '',
      `Closed Trades: <b>${summary.total}</b>`,
      `Avg PnL: <b>${summary.avgPnl.toFixed(1)}%</b>`,
      `Win Rate: <b>${summary.winRate.toFixed(1)}%</b>`,
      '',
      summary.bestSocials
        ? [
            '🏆 <b>Best Social Pattern</b>',
            `Socials: <b>${summary.bestSocials.socials}</b>`,
            `Trades: <b>${summary.bestSocials.count}</b>`,
            `Avg PnL: <b>${summary.bestSocials.avgPnl.toFixed(1)}%</b>`,
          ].join('\n')
        : 'No learning pattern yet.',
    ].join('\n'),
    { parse_mode: 'HTML' }
  );
});

  bot.command('autostats', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    if (!isAdmin(telegramId)) {
      await ctx.reply('Admin only.');
      return;
    }

    const stats = getAutoTradeStats();

    await ctx.reply(
      [
        '🤖 <b>Auto Trade Stats</b>',
        '',
        `<b>Closed Trades:</b> ${stats.total}`,
        `<b>Wins:</b> ${stats.wins}`,
        `<b>Losses:</b> ${stats.losses}`,
        `<b>Win Rate:</b> ${stats.winRate.toFixed(1)}%`,
        `<b>Avg ROI:</b> ${stats.avgRoi.toFixed(1)}%`,
        `<b>Total Paper PnL:</b> ${stats.totalPnlSol >= 0 ? '+' : ''}${stats.totalPnlSol.toFixed(4)} SOL`,
        '',
        stats.best
          ? `<b>Best Trade:</b> ${stats.best.symbol} • ${stats.best.finalRoi.toFixed(1)}%`
          : '<b>Best Trade:</b> n/a',
        '',
        `<b>Open Trades:</b> ${stats.openTrades.length}`,
        ...stats.openTrades.map(
          (t, i) =>
            `${i + 1}. ${t.symbol} • Entry $${t.entryPrice} • Stop $${t.stopPrice}`
        ),
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
  });

  bot.action('PAUSE_AUTO_TRADE', async (ctx) => {
  const telegramId = String(ctx.from?.id ?? '');
  if (!isAdmin(telegramId)) return ctx.answerCbQuery('Admin only');

  pauseAutoTrade();
  await ctx.answerCbQuery('Auto trade paused');
  await ctx.reply('⏸️ <b>Auto Trade Paused</b>\n\nNo new auto-buys will be opened.', {
    parse_mode: 'HTML',
  });
});

bot.action('RESUME_AUTO_TRADE', async (ctx) => {
  const telegramId = String(ctx.from?.id ?? '');
  if (!isAdmin(telegramId)) return ctx.answerCbQuery('Admin only');

  resumeAutoTrade();
  await ctx.answerCbQuery('Auto trade resumed');
  await ctx.reply('▶️ <b>Auto Trade Resumed</b>\n\nEligible high-conviction signals can auto-buy again.', {
    parse_mode: 'HTML',
  });
});

bot.action('AUTO_TRADE_STATUS', async (ctx) => {
  const telegramId = String(ctx.from?.id ?? '');
  if (!isAdmin(telegramId)) return ctx.answerCbQuery('Admin only');

  const stats = getAutoTradeStats();
  const paused = isAutoTradePaused();

  await ctx.answerCbQuery();
  await ctx.reply(
    [
      '🤖 <b>Auto Trade Control</b>',
      '',
      `Status: <b>${paused ? 'PAUSED' : 'LIVE'}</b>`,
      `Open Trades: <b>${stats.openTrades.length}</b>`,
      `Closed Trades: <b>${stats.total}</b>`,
      `Win Rate: <b>${stats.winRate.toFixed(1)}%</b>`,
      `Avg ROI: <b>${stats.avgRoi.toFixed(1)}%</b>`,
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⏸ Pause', callback_data: 'PAUSE_AUTO_TRADE' },
            { text: '▶️ Resume', callback_data: 'RESUME_AUTO_TRADE' },
          ],
          [{ text: '⬅️ Main Menu', callback_data: 'MAIN_MENU' }],
        ],
      },
    }
  );
});

    bot.action(/^AUTO_SELL_(25|50|100)_(.+)$/, async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    const percent = Number((ctx.match as RegExpExecArray)[1]) as 25 | 50 | 100;
    const mint = (ctx.match as RegExpExecArray)[2];

    try {
      await ctx.answerCbQuery(`Auto trade sell ${percent}%...`);

      const result = await manualCloseAutoTrade(mint, percent);

      await ctx.reply(
        result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      await ctx.reply(
        `❌ Auto sell failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

      bot.action('DEX_PAID', async (ctx) => {
    await ctx.answerCbQuery();

    const signals = await fetchSignalsByType('DEX_PAID', 10);

    if (!signals.length) {
      await ctx.reply(
        [
          '💎 <b>DEX Paid Radar</b>',
          '',
          'No DEX Paid alpha signals captured yet.',
          '',
          'The engine is watching for:',
          '• Fresh paid / profiled tokens',
          '• Tradable liquidity',
          '• Strong 5m volume',
          '• Buy pressure > sell pressure',
          '',
          'When a signal fires, it will appear here.',
        ].join('\n'),
        { parse_mode: 'HTML', ...backToMainMenu() }
      );
      return;
    }

    const lines = [
      '💎 <b>DEX Paid Radar</b>',
      '',
      `<b>Latest ${signals.length} DEX Paid signals</b>`,
      '',
      ...signals.map((s: any, i: number) =>
        [
          `${i + 1}. <b>${s.title ?? 'DEX Paid Signal'}</b>`,
          `<b>${s.symbol ?? 'Unknown'}</b>`,
          `Conviction: <b>${s.conviction ?? 'n/a'}</b>`,
          s.score != null ? `Score: <b>${Number(s.score).toFixed(0)}/100</b>` : '',
          s.roi_high != null ? `ROI High: <b>${Number(s.roi_high).toFixed(1)}%</b>` : '',
          s.roi_now != null ? `ROI Now: <b>${Number(s.roi_now).toFixed(1)}%</b>` : '',
          s.alert_price != null ? `Alert Price: <b>$${s.alert_price}</b>` : '',
          s.high_after_alert != null ? `High After Alert: <b>$${s.high_after_alert}</b>` : '',
          s.current_price != null ? `Current Price: <b>$${s.current_price}</b>` : '',
          s.summary ?? '',
          `Mint: <code>${s.token}</code>`,
        ]
          .filter(Boolean)
          .join('\n')
      ),
    ];

    await ctx.reply(lines.join('\n\n'), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          ...signals.slice(0, 5).map((s: any) => [
            {
              text: `📈 ${s.symbol ?? 'Chart'}`,
              url: s.dex_url || `https://dexscreener.com/solana/${s.token}`,
            },
            {
              text: '🟢 Buy',
              url: s.buy_url || `https://jup.ag/swap/SOL-${s.token}`,
            },
          ]),
          [{ text: '⬅️ Main Menu', callback_data: 'MAIN_MENU' }],
        ],
      },
    });
  });

  bot.action('WHALE_RADAR', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🐋 <b>Whale Radar</b>',
        '',
        'Tracks selected smart wallets and whale activity.',
        '',
        'Signals:',
        '• Wallet buy',
        '• Wallet sell',
        '• Multiple wallets buying same token',
        '• Early smart-money entries',
      ].join('\n'),
      {
        parse_mode: 'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '⬅️ Research',
                'ALPHA_FEED',
              ),
            ],

            [
              Markup.button.callback(
                '🏠 Main Menu',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      }
    );
  });

  bot.action('CREATOR_INTEL', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🧠 <b>Creator Intel</b>',
        '',
        'Review creator history and launch quality.',
        '',
        '• Previous launch outcomes',
        '• Repeat winner behaviour',
        '• Creator reputation',
        '• Risk / farm history',
      ].join('\n'),
      {
        parse_mode: 'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '⬅️ Research',
                'ALPHA_FEED',
              ),
            ],

            [
              Markup.button.callback(
                '🏠 Main Menu',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      }
    );
  });

  bot.action('TRADE_MENU', async (ctx) => {
  await ctx.answerCbQuery();

  const telegramId = String(ctx.from?.id ?? '');
  const admin = isAdmin(telegramId);
  const stats = getAutoTradeStats();
  const paused = isAutoTradePaused();

  await renderScreen(ctx,
    [
      '📈 <b>TRADE TERMINAL</b>',
      '━━━━━━━━━━━━━━━━',
      '',
      admin
        ? '<b>Admin trading wallet active.</b>'
        : '<b>Trading controls are admin-only for now.</b>',
      '',
      `Auto Trade: <b>${paused ? 'PAUSED' : 'LIVE'}</b>`,
      `Open Trades: <b>${stats.openTrades.length}</b>`,
      `Closed Trades: <b>${stats.total}</b>`,
      `Win Rate: <b>${stats.winRate.toFixed(1)}%</b>`,
      '',
      'Manage entries, exits, and risk controls below.',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: tradeTerminalMenu(admin).reply_markup,
    }
  );
});

  bot.action('TRADE_INFO', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '⚡ <b>Trade Buttons</b>',
        '',
        'Buy/Sell buttons appear directly under eligible token alerts.',
        '',
        'Example:',
        '• Buy 0.03 SOL',
        '• Buy 0.05 SOL',
        '• Sell 25%',
        '• Sell All',
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
  });

  bot.action('POSITIONS', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '📈 <b>Positions</b>',
        '',
        'Current status:',
        '• Open positions',
        '• Entry price',
        '• Current value',
        '• PnL',
        '• Exit buttons',
      ].join('\n'),
      {
        parse_mode: 'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '⬅️ Trade',
                'TRADE_MENU',
              ),
            ],

            [
              Markup.button.callback(
                '🏠 Main Menu',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      }
    );
  });

  bot.action('SNIPER', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🎯 <b>Sniper</b>',
        '',
        'Available / upcoming tools:',
        '• Creator sniper',
        '• DEX paid sniper',
        '• Wallet copy-watch',
        '• Admin-only fast buy',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.action('RISK_CONTROLS', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🛡 <b>Risk Controls</b>',
        '',
        'Risk controls:',
        '• 20% stop loss',
        '• Trailing stop',
        '• Take profit ladder',
        '• Moon bag mode',
        '',
        'Public wallet safety will be handled carefully before release.',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.action('ALPHA_POINTS', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🏆 <b>Alpha Points</b>',
        '',
        'Coming soon.',
        '',
        'Points will be based on verified activity only:',
        '• Verified signal entries',
        '• Verified exits',
        '• Approved wallet/creator contributions',
        '• Paid membership multiplier',
        '',
        'No click farming. No fake activity.',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

      bot.action('HISTORY', async (ctx) => {
    await ctx.answerCbQuery();

    const signals = await fetchBestStoredSignals(10);

    function fmtPrice(value: unknown) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 'n/a';
      if (n < 0.000001) return `$${n.toExponential(2)}`;
      if (n < 0.01) return `$${n.toFixed(8)}`;
      return `$${n.toFixed(6)}`;
    }

    function fmtRoi(value: unknown) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 'n/a';
      return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
    }

    function resultLabel(value: unknown) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 'Tracking';
      if (n >= 200) return '🚀 Moonshot';
      if (n >= 100) return '🔥 2x+ Winner';
      if (n >= 50) return '💎 Strong Winner';
      if (n >= 20) return '✅ Winner';
      if (n >= 0) return '🟡 Green';
      return '🔻 Drawdown';
    }

    if (!signals.length) {
      await ctx.reply(
        [
          '📜 <b>Alpha History</b>',
          '',
          'No completed signal performance yet.',
          '',
          'Once calls start moving, this page will show:',
          '• Alert Price',
          '• High After Alert',
          '• Current Price',
          '• ROI High',
          '• ROI Now',
        ].join('\n'),
        { parse_mode: 'HTML', ...backToMainMenu() }
      );
      return;
    }

    await ctx.reply(
      [
        '📜 <b>ALPHA HISTORY</b>',
        '',
        '<b>Best Calls by High ROI</b>',
        '',
        ...signals.map((s: any, i: number) =>
          [
            `${i + 1}. <b>${s.symbol ?? 'Unknown'}</b>`,
            `${s.title ?? 'Alpha Signal'}`,
            '',
            `🚀 ROI High: <b>${fmtRoi(s.roi_high)}</b>`,
            `💰 ROI Now: <b>${fmtRoi(s.roi_now)}</b>`,
            '',
            `🎯 Alert Price: <b>${fmtPrice(s.alert_price)}</b>`,
            `📈 High After Alert: <b>${fmtPrice(s.high_after_alert)}</b>`,
            `📍 Current Price: <b>${fmtPrice(s.current_price)}</b>`,
            '',
            `Status: <b>${resultLabel(s.roi_high)}</b>`,
            `Mint: <code>${s.token}</code>`,
          ].join('\n')
        ),
      ].join('\n\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.action('PREMIUM', async (ctx) => {
    await ctx.answerCbQuery();

    await renderScreen(
      ctx,
      [
        '⭐ <b>ALPHAOS ACCESS</b>',
        '━━━━━━━━━━━━━━━━',
        '',
        '<b>Free</b>',
        '• Limited / delayed intelligence',
        '• Core opportunity access',
        '',
        '<b>Pro</b>',
        '• Faster actionable alerts',
        '• Wallet tracking',
        '• Smart-money intelligence',
        '• Creator intelligence',
        '',
        '<b>Admin</b>',
        '• Priority delivery',
        '• Trading controls',
        '• Advanced system tools',
        '',
        'Choose an option below.',
      ].join('\n'),
      {
        parse_mode:
          'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '⭐ View Plans',
                'PREMIUM_PLANS',
              ),
            ],
            [
              Markup.button.callback(
                '📋 My Status',
                'USER_STATUS',
              ),

              Markup.button.callback(
                '⬅️ Main Menu',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      },
    );
  });

  bot.action('PREMIUM_PLANS', async (ctx) => {
    await ctx.answerCbQuery();

    await renderScreen(
      ctx,
      [
        '⭐ <b>ALPHAOS PLANS</b>',
        '',
        '<b>15 Days</b> · 0.1 SOL',
        '<b>30 Days</b> · 0.15 SOL',
        '',
        'Select a plan to continue.',
      ].join('\n'),
      {
        parse_mode:
          'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '15 Days · 0.1 SOL',
                'PLAN_15',
              ),
            ],
            [
              Markup.button.callback(
                '30 Days · 0.15 SOL',
                'PLAN_30',
              ),
            ],
            [
              Markup.button.callback(
                '⬅️ Access',
                'PREMIUM',
              ),

              Markup.button.callback(
                '🏠 Main Menu',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      },
    );
  });

  bot.action('USER_STATUS', async (ctx) => {
    await ctx.answerCbQuery();

    const telegramId =
      String(
        ctx.from?.id ??
        '',
      );

    const user =
      await getUserByTelegramId(
        telegramId,
      );

    if (!user) {
      await ctx.reply(
        'No user record found. Send /start first.',
      );

      return;
    }

    const lines = [
      '📋 <b>MY ALPHAOS STATUS</b>',
      '',
      `Tier: <b>${String(
        user.tier,
      ).toUpperCase()}</b>`,
    ];

    if (
      user.tier ===
      'admin'
    ) {
      lines.push(
        'Access: <b>Admin</b>',
        'Priority: <b>Immediate</b>',
        'Subscription: <b>Active</b>',
      );
    } else {
      lines.push(
        `Subscription: <b>${String(
          user.subscription_status,
        ).toUpperCase()}</b>`,

        `Trial Used: <b>${user.free_trial_used}/${user.free_trial_limit}</b>`,

        `Plan Days: <b>${user.paid_plan_days ??
          'n/a'}</b>`,
      );
    }

    await renderScreen(
      ctx,
      lines.join('\n'),
      {
        parse_mode:
          'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '⬅️ Access',
                'PREMIUM',
              ),

              Markup.button.callback(
                '🏠 Main Menu',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      },
    );
  });

  bot.action('SETTINGS', async (ctx) => {
    await ctx.answerCbQuery();

    await renderScreen(
      ctx,
      [
        '⚙️ <b>ALPHAOS CONTROLS</b>',
        '━━━━━━━━━━━━━━━━',
        '',
        'Manage what AlphaOS watches and how you use it.',
        '',
        '🎯 <b>Strategies</b>',
        'Turn individual intelligence engines ON or OFF.',
        '',
        '🐋 <b>Wallet Tracking</b>',
        'Add, pause or remove tracked wallets.',
        '',
        '📈 <b>Trade</b>',
        'Review execution and risk controls.',
        '',
        '⭐ <b>Access</b>',
        'View your AlphaOS membership options.',
      ].join('\n'),
      {
        parse_mode: 'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '🎯 Strategies',
                'STRATEGY_SETTINGS',
              ),

              Markup.button.callback(
                '🐋 Wallets',
                'WALLET_TRACKING',
              ),
            ],
            [
              Markup.button.callback(
                '📈 Trade',
                'TRADE_MENU',
              ),

              Markup.button.callback(
                '⭐ Premium',
                'PREMIUM',
              ),
            ],
            [
              Markup.button.callback(
                'ℹ️ How AlphaOS Works',
                'INTRO',
              ),
            ],
            [
              Markup.button.callback(
                '⬅️ Main Menu',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      },
    );
  });

  bot.action('WALLET', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '💰 <b>Wallet</b>',
        '',
        'Public wallet linking is not enabled yet.',
        '',
        'For safety, AlphaOS will not ask public users to paste private keys in Telegram chat.',
        '',
        'Admin trading uses a separate configured trading wallet only.',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.command('plans', async (ctx) => {
    await ctx.reply(
      [
        '👑 *AlphaOS Plans*',
        '',
        '*15 Days* — `0.1 SOL`',
        '*30 Days* — `0.15 SOL`',
        '',
        '*Free*',
        '• Limited / delayed signals',
        '• Basic Alpha Feed',
        '',
        '*Pro*',
        '• Faster signals',
        '• Whale Radar',
        '• Creator Intel',
        '• Higher future Alpha Points multiplier',
        '',
        '*VIP*',
        '• Highest conviction feed',
        '• Advanced trading tools',
        '• Priority alpha access',
        '',
        'Use /upgrade to continue.',
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('upgrade', async (ctx) => {
    const wallet = config.solanaPaymentWallet || 'SET_SOLANA_PAYMENT_WALLET';

    await ctx.reply(
      [
        '👑 *Upgrade AlphaOS*',
        '',
        '*15 Days* — `0.1 SOL`',
        '*30 Days* — `0.15 SOL`',
        '',
        '*Send payment to:*',
        `\`${wallet}\``,
        '',
        'Then choose a plan below and paste your transaction hash.',
        '',
        '_Your membership starts when payment is approved._',
      ].join('\n'),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('15 Days • 0.1 SOL', 'PLAN_15')],
          [Markup.button.callback('30 Days • 0.15 SOL', 'PLAN_30')],
        ]),
      }
    );
  });

  bot.command('status', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = await getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply('No user record found yet. Send /start first.');
      return;
    }

    const tier = String(user.tier).toUpperCase();
    const lines = ['📋 *AlphaOS Status*', '', `*Tier:* ${tier}`];

    if (user.tier === 'admin') {
      lines.push(`*Access:* Full Alpha Terminal`);
      lines.push(`*Priority:* Instant`);
      lines.push(`*Trial:* Not applicable`);
      lines.push(`*Subscription:* Active`);
    } else {
      lines.push(`*Subscription:* ${String(user.subscription_status).toUpperCase()}`);
      lines.push(`*Free Trial Used:* ${user.free_trial_used}/${user.free_trial_limit}`);
      lines.push(`*Paid Plan Days:* ${user.paid_plan_days ?? 'n/a'}`);
      lines.push(`*Started:* ${formatDate(user.paid_started_at)}`);
      lines.push(`*Active Until:* ${formatDate(user.paid_active_until)}`);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('stats', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.reply('Admin only.');
      return;
    }

    const counts = await getUserCounts();
    const pending = await getPendingPayments();

    await ctx.reply(
      [
        '📊 *AlphaOS Stats*',
        '',
        `*Total Users:* ${counts?.total_users ?? 0}`,
        `*Admin Users:* ${counts?.admin_users ?? 0}`,
        `*Paid Active:* ${counts?.paid_active_users ?? 0}`,
        `*Free Users:* ${counts?.free_users ?? 0}`,
        `*Expired Users:* ${counts?.expired_users ?? 0}`,
        `*Pending Payments:* ${pending.length}`,
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('pending', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.reply('Admin only.');
      return;
    }

    const pending = await getPendingPayments();
    if (!pending.length) {
      await ctx.reply('No pending payments.');
      return;
    }

    const text = pending
      .slice(0, 10)
      .map((p, i) =>
        [
          `${i + 1}. ${p.first_name ?? 'Unknown'} ${p.username ? `(@${p.username})` : ''}`,
          `Telegram ID: ${p.telegram_id}`,
          `Plan: ${p.plan_days} days`,
          `Amount: ${p.amount_sol} SOL`,
          `Tx Hash: ${p.tx_hash ?? 'n/a'}`,
          `Requested: ${formatDate(p.requested_at)}`,
        ].join('\n')
      )
      .join('\n\n');

    await ctx.reply(`💰 *Pending Payments*\n\n${text}`, { parse_mode: 'Markdown' });
  });

  bot.command('approve', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.reply('Admin only.');
      return;
    }

    const parts = ctx.message.text.trim().split(/\s+/);
    const targetTelegramId = parts[1];
    const planDays = Number(parts[2]) as 15 | 30;

    if (!targetTelegramId || ![15, 30].includes(planDays)) {
      await ctx.reply('Usage: /approve <telegram_id> <15|30>');
      return;
    }

    try {
      const result = await approveLatestPendingPayment({
        telegramId: targetTelegramId,
        planDays,
        approvedBy: telegramId,
      });

      await ctx.reply(
        `✅ Approved ${targetTelegramId} for ${planDays} days.\nActive until: ${formatDate(result.paidActiveUntil)}`
      );

      await bot.telegram.sendMessage(
        Number(targetTelegramId),
        [
          '✅ Your AlphaOS membership is now active.',
          '',
          `Plan: ${planDays} days`,
          `Active Until: ${formatDate(result.paidActiveUntil)}`,
          '',
          'You will now receive paid alerts.',
        ].join('\n')
      );
    } catch (error) {
      await ctx.reply(`Approve failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  bot.command('reject', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.reply('Admin only.');
      return;
    }

    const parts = ctx.message.text.trim().split(/\s+/);
    const targetTelegramId = parts[1];

    if (!targetTelegramId) {
      await ctx.reply('Usage: /reject <telegram_id>');
      return;
    }

    try {
      await rejectLatestPendingPayment({
        telegramId: targetTelegramId,
        approvedBy: telegramId,
      });

      await ctx.reply(`❌ Rejected latest pending payment for ${targetTelegramId}.`);

      await bot.telegram.sendMessage(
        Number(targetTelegramId),
        [
          '❌ Your payment request was rejected.',
          '',
          'Please check your transaction hash and try again with /upgrade.',
        ].join('\n')
      );
    } catch (error) {
      await ctx.reply(`Reject failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  bot.action('PLAN_15', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    upgradeSessions.set(telegramId, {
      telegramId,
      planDays: 15,
      amountSol: 0.1,
      awaitingTxHash: true,
    });

    await ctx.answerCbQuery();
    await ctx.reply(
      ['✅ Plan selected: *15 days*', 'Amount: `0.1 SOL`', '', 'Now paste your transaction hash.'].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('PLAN_30', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');

    upgradeSessions.set(telegramId, {
      telegramId,
      planDays: 30,
      amountSol: 0.15,
      awaitingTxHash: true,
    });

    await ctx.answerCbQuery();
    await ctx.reply(
      ['✅ Plan selected: *30 days*', 'Amount: `0.15 SOL`', '', 'Now paste your transaction hash.'].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.action(/^ADMIN_BUY_SMALL_(.+)$/, async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    const mint = (ctx.match as RegExpExecArray)[1];

    try {
      await ctx.answerCbQuery(`Buying ${config.adminBuyAmountSmallSol} SOL...`);

      const trade = await adminBuyToken({
        outputMint: mint,
        amountSol: config.adminBuyAmountSmallSol,
      });

      await ctx.reply(
        [
          '✅ <b>BUY EXECUTED</b>',
          `Mint: <code>${mint}</code>`,
          `Spent: <b>${config.adminBuyAmountSmallSol} SOL</b>`,
          `Tx: <code>${trade.signature}</code>`,
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Sell 25%', callback_data: `ADMIN_SELL_25_${mint}` },
                { text: 'Sell 50%', callback_data: `ADMIN_SELL_50_${mint}` },
                { text: 'Sell All', callback_data: `ADMIN_SELL_100_${mint}` },
              ],
            ],
          },
        }
      );
    } catch (error) {
      await ctx.reply(`❌ Buy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  bot.action(/^ADMIN_BUY_DEFAULT_(.+)$/, async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    const mint = (ctx.match as RegExpExecArray)[1];

    try {
      await ctx.answerCbQuery(`Buying ${config.adminBuyAmountDefaultSol} SOL...`);

      const trade = await adminBuyToken({
        outputMint: mint,
        amountSol: config.adminBuyAmountDefaultSol,
      });

      await ctx.reply(
        [
          '✅ <b>BUY EXECUTED</b>',
          `Mint: <code>${mint}</code>`,
          `Spent: <b>${config.adminBuyAmountDefaultSol} SOL</b>`,
          `Tx: <code>${trade.signature}</code>`,
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Sell 25%', callback_data: `ADMIN_SELL_25_${mint}` },
                { text: 'Sell 50%', callback_data: `ADMIN_SELL_50_${mint}` },
                { text: 'Sell All', callback_data: `ADMIN_SELL_100_${mint}` },
              ],
            ],
          },
        }
      );
    } catch (error) {
      await ctx.reply(`❌ Buy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  bot.action(/^ADMIN_SELL_(25|50|100)_(.+)$/, async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    const percent = Number((ctx.match as RegExpExecArray)[1]) as 25 | 50 | 100;
    const mint = (ctx.match as RegExpExecArray)[2];

    try {
      await ctx.answerCbQuery(`Selling ${percent}%...`);

      const trade = await adminSellTokenPercentWithRetry({
        inputMint: mint,
        percent,
      });

      await ctx.reply(
        ['✅ <b>SELL EXECUTED</b>', `Mint: <code>${mint}</code>`, `Sold: <b>${percent}%</b>`, `Tx: <code>${trade.signature}</code>`].join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      await ctx.reply(`❌ Sell failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  bot.action(
  /^COPY_CA_(0x[a-fA-F0-9]{40})$/,
  async (ctx) => {
    const contract =
      (ctx.match as RegExpExecArray)[1];

    await ctx.answerCbQuery(
      'Contract ready to copy',
    );

    await ctx.reply(
      [
        '📋 <b>Contract Address</b>',
        '',
        `<code>${contract}</code>`,
      ].join('\n'),
      {
        parse_mode:
          'HTML',
      },
    );
  },
);

  bot.on('text', async (ctx, next) => {
    const telegramId = String(ctx.from?.id ?? '');
    const session = upgradeSessions.get(telegramId);

    if (!session?.awaitingTxHash) {
      return next();
    }

    const txHash = ctx.message.text.trim();

    if (txHash.startsWith('/')) {
      return next();
    }

    const alreadyUsed = await txHashExists(txHash);
    if (alreadyUsed) {
      await ctx.reply('This transaction hash was already submitted. Please check and try again.');
      return;
    }

    await createPendingPayment({
      telegramId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      planDays: session.planDays,
      amountSol: session.amountSol,
      txHash,
    });

    upgradeSessions.delete(telegramId);

    await ctx.reply(
      [
        '✅ Payment request submitted.',
        '',
        'Your transaction hash has been recorded and is awaiting approval.',
        'Your subscription will begin once activated.',
      ].join('\n')
    );

    await bot.telegram.sendMessage(
      Number(config.adminTelegramId),
      [
        '💰 New Upgrade Request',
        '',
        `User: ${ctx.from?.first_name ?? 'Unknown'} ${ctx.from?.username ? `(@${ctx.from.username})` : ''}`,
        `Telegram ID: ${telegramId}`,
        `Plan: ${session.planDays} days`,
        `Amount: ${session.amountSol} SOL`,
        `Tx Hash: ${txHash}`,
        '',
        `Approve with: /approve ${telegramId} ${session.planDays}`,
        `Reject with: /reject ${telegramId}`,
      ].join('\n')
    );
  });
}