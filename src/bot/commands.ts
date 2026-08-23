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
  getLatestPaymentForUser,
  getUserByTelegramId,
  getUserCounts,
  rejectLatestPendingPayment,
  txHashExists,
  upsertUser,
} from '../core/subscriptions.js';
import type { PendingUpgradeSession } from '../types/bot.js';
import {
  backHome,
  backToMainMenu,
  mainAlphaMenu,
  tradingMenu,
} from './menus.js';
import {
  clearConversationState,
  getConversationState,
  setConversationState,
} from './conversationState.js';
import {
  accessProfileForUser,
  hasCapability,
} from '../product/capabilities.js';
import { getContextAccess, requireCapability } from './accessControl.js';
import { renderIntelligenceHome } from './intelligenceCenter.js';
import { getLatestOpportunities } from '../core/opportunityRegistry.js';
import { escapeTelegramHtml } from '../ui/escapeHtml.js';
import { isLikelySolanaSignature } from './paymentInput.js';

const upgradeSessions = new Map<string, PendingUpgradeSession>();
const recentTradeActions = new Map<string, number>();

function acquireTradeAction(key: string): boolean {
  const now = Date.now();
  const expiresAt = recentTradeActions.get(key) ?? 0;
  if (expiresAt > now) return false;
  recentTradeActions.set(key, now + 5 * 60_000);
  return true;
}

function releaseTradeAction(key: string) {
  recentTradeActions.delete(key);
}

function clearPaymentInputState(telegramId: string) {
  upgradeSessions.delete(telegramId);
  if (getConversationState(telegramId) === 'SUBMIT_PAYMENT_HASH') {
    clearConversationState(telegramId);
  }
}

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
  } catch (error) {
    if (String(error).toLowerCase().includes('message is not modified')) return;
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

  const access = accessProfileForUser(user);
  const opportunities = await getLatestOpportunities(30);
  const liveCount = opportunities.filter((row: any) =>
    !['EXECUTED', 'REJECTED', 'EXPIRED', 'REVIEWED']
      .includes(String(row.status ?? '').toUpperCase()),
  ).length;

  await renderScreen(
    ctx,
    [
      '🧠 <b>ALPHAOS</b>',
      access.label,
      '',
      `⚡ Live opportunities: <b>${liveCount}</b>`,
      'Understand · Monitor · Decide',
      '',
      '<i>Evidence before execution.</i>',
    ].join(
      '\n',
    ),
    {
      parse_mode:
        'HTML',

      reply_markup:
        mainAlphaMenu(access)
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
      'Choose which normal intelligence alerts you receive.',
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
              '✅ Open AlphaOS',
              'MAIN_MENU',
            ),
          ],
        ]).reply_markup,
    },
  );
}

async function renderSelectedPlan(
  ctx: any,
  planDays: 15 | 30,
  amountSol: 0.1 | 0.15,
) {
  await renderScreen(ctx, [
    '⭐ <b>UPGRADE TO PRO</b>',
    '',
    `Selected plan: <b>${planDays} days</b>`,
    `Amount: <b>${amountSol} SOL</b>`,
    '',
    '<b>Payment destination</b>',
    `<code>${escapeTelegramHtml(config.solanaPaymentWallet || 'Payment wallet unavailable')}</code>`,
    '',
    'Send the exact amount on Solana. Then submit the transaction signature for manual verification.',
  ].join('\n'), {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('📨 Submit Payment', `SUBMIT_PLAN_${planDays}`)],
      [
        Markup.button.callback('⬅️ Compare Plans', 'MEMBERSHIP_PLANS'),
        Markup.button.callback('✖️ Cancel', 'UPGRADE_CANCEL'),
      ],
      [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
    ]).reply_markup,
  });
}

async function beginPaymentSubmission(
  ctx: any,
  planDays: 15 | 30,
  amountSol: 0.1 | 0.15,
) {
  const telegramId = String(ctx.from?.id ?? '');
  const latestPayment = await getLatestPaymentForUser(telegramId);
  if (String(latestPayment?.status ?? '').toLowerCase() === 'pending') {
    await ctx.answerCbQuery('A payment is already pending review');
    await ctx.reply(
      'A payment submission is already awaiting manual verification.',
      Markup.inlineKeyboard([
        [Markup.button.callback('💳 Payment Status', 'PAYMENT_STATUS')],
        [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
      ]),
    );
    return;
  }

  upgradeSessions.set(telegramId, {
    telegramId,
    planDays,
    amountSol,
    awaitingTxHash: true,
  });
  setConversationState(telegramId, 'SUBMIT_PAYMENT_HASH');
  await ctx.answerCbQuery('Ready for transaction signature');
  await ctx.reply(
    [
      '📨 <b>SUBMIT PAYMENT</b>',
      '',
      `Plan: <b>${planDays} days</b> · <b>${amountSol} SOL</b>`,
      '',
      'Paste the Solana transaction signature below.',
      'It will be reviewed manually before access is activated.',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('✖️ Cancel', 'UPGRADE_CANCEL')],
        [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
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

    clearPaymentInputState(telegramId);

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
    const telegramId = String(ctx.from?.id ?? '');
    clearPaymentInputState(telegramId);
    clearConversationState(telegramId);
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
  await renderIntelligenceHome(ctx);
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
          [{ text: '🏠 Home', callback_data: 'MAIN_MENU' }],
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
    if (!await requireCapability(ctx, 'intelligence.investigations', 'INTELLIGENCE_CENTER')) return;
    await ctx.answerCbQuery();

    const signals = await fetchSignalsByType('DEX_PAID', 10);

    if (!signals.length) {
      await ctx.reply(
        [
          '🔎 <b>INVESTIGATIONS</b>',
          '',
          'No qualifying investigations are available right now.',
        ].join('\n'),
        { parse_mode: 'HTML', ...backToMainMenu() }
      );
      return;
    }

    const lines = [
      '🔎 <b>INVESTIGATIONS</b>',
      '',
      `<b>Latest ${signals.length} DEX Paid signals</b>`,
      '',
      ...signals.map((s: any, i: number) =>
        [
          `${i + 1}. <b>${escapeTelegramHtml(String(s.title ?? 'DEX Paid Signal'))}</b>`,
          `<b>${escapeTelegramHtml(String(s.symbol ?? 'Unknown'))}</b>`,
          `Conviction: <b>${escapeTelegramHtml(String(s.conviction ?? 'n/a'))}</b>`,
          s.score != null ? `Score: <b>${Number(s.score).toFixed(0)}/100</b>` : '',
          s.roi_high != null ? `ROI High: <b>${Number(s.roi_high).toFixed(1)}%</b>` : '',
          s.roi_now != null ? `ROI Now: <b>${Number(s.roi_now).toFixed(1)}%</b>` : '',
          s.alert_price != null ? `Alert Price: <b>$${s.alert_price}</b>` : '',
          s.high_after_alert != null ? `High After Alert: <b>$${s.high_after_alert}</b>` : '',
          s.current_price != null ? `Current Price: <b>$${s.current_price}</b>` : '',
          escapeTelegramHtml(String(s.summary ?? '')),
          `Mint: <code>${escapeTelegramHtml(String(s.token))}</code>`,
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
              text: `📈 ${String(s.symbol ?? 'Chart').slice(0, 30)}`,
              url: s.dex_url || `https://dexscreener.com/solana/${s.token}`,
            },
            {
              text: '🟢 Buy',
              url: s.buy_url || `https://jup.ag/swap/SOL-${s.token}`,
            },
          ]),
          [{ text: '⬅️ Intelligence', callback_data: 'INTELLIGENCE_CENTER' }],
          [{ text: '🏠 Home', callback_data: 'MAIN_MENU' }],
        ],
      },
    });
  });

  bot.action('WHALE_RADAR', async (ctx) => {
    if (!await requireCapability(ctx, 'intelligence.smartMoney', 'INTELLIGENCE_CENTER')) return;
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🐋 <b>SMART MONEY</b>',
        '',
        'Open the current data-backed Smart Money view.',
      ].join('\n'),
      {
        parse_mode: 'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '🐋 Open Smart Money',
                'INTEL_SMART_MONEY',
              ),
            ],

            [
              Markup.button.callback(
                '🏠 Home',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      }
    );
  });

  bot.action('CREATOR_INTEL', async (ctx) => {
    if (!await requireCapability(ctx, 'intelligence.creators', 'INTELLIGENCE_CENTER')) return;
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '👤 <b>CREATORS</b>',
        '',
        'Open the current data-backed creator intelligence view.',
      ].join('\n'),
      {
        parse_mode: 'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '👤 Open Creators',
                'INTEL_CREATORS',
              ),
            ],

            [
              Markup.button.callback(
                '🏠 Home',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      }
    );
  });

  bot.action('TRADE_MENU', async (ctx) => {
  await ctx.answerCbQuery();

  const access = await getContextAccess(ctx);
  const admin = hasCapability(access, 'trading.admin');

  await renderScreen(ctx,
    (admin
      ? [
          '📈 <b>TRADING</b>',
          '',
          'Private admin execution and risk controls.',
          '',
          '<i>Review every action before execution.</i>',
        ]
      : [
          '📈 <b>TRADING</b>',
          '',
          'Open supported charts and external trading routes from an opportunity.',
          '',
          'AlphaOS never asks for a private key in Telegram.',
        ]).join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: tradingMenu(access).reply_markup,
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
    if (!await requireCapability(ctx, 'trading.admin', 'TRADE_MENU')) return;
    await ctx.answerCbQuery();
    const stats = getAutoTradeStats();
    await ctx.reply(
      [
        '📈 <b>POSITIONS</b>',
        '',
        stats.openTrades.length
          ? `Open positions: <b>${stats.openTrades.length}</b>`
          : 'No open positions.',
        ...stats.openTrades.slice(0, 8).map((position, index) =>
          `${index + 1}. <b>${escapeTelegramHtml(position.symbol)}</b> · Entry $${position.entryPrice}`,
        ),
      ].join('\n'),
      {
        parse_mode: 'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '⬅️ Trading',
                'TRADE_MENU',
              ),
            ],

            [
              Markup.button.callback(
                '🏠 Home',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      }
    );
  });

  bot.action('SNIPER', async (ctx) => {
    await ctx.answerCbQuery();
    await renderScreen(ctx, '⚡ <b>OPPORTUNITIES</b>\n\nThis destination has moved to Opportunities.', {
      parse_mode: 'HTML',
      reply_markup: backHome('Trading', 'TRADE_MENU').reply_markup,
    });
  });

  bot.action('RISK_CONTROLS', async (ctx) => {
    if (!await requireCapability(ctx, 'trading.admin', 'TRADE_MENU')) return;
    await ctx.answerCbQuery();
    await renderScreen(ctx, '🛡 <b>RISK CONTROLS</b>\n\nOpen the current admin trading controls.', {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🛡 Open Risk Controls', 'ADMIN_TRADE_SETTINGS')],
        [Markup.button.callback('⬅️ Trading', 'TRADE_MENU'), Markup.button.callback('🏠 Home', 'MAIN_MENU')],
      ]).reply_markup,
    });
  });

  bot.action('ALPHA_POINTS', async (ctx) => {
    await ctx.answerCbQuery();
    await renderScreen(ctx, '⭐ <b>MEMBERSHIP</b>\n\nThis legacy destination is not part of the current AlphaOS membership.', {
      parse_mode: 'HTML',
      reply_markup: backHome('Membership', 'MEMBERSHIP_HOME').reply_markup,
    });
  });

      bot.action('HISTORY', async (ctx) => {
    if (!await requireCapability(ctx, 'intelligence.performance', 'INTELLIGENCE_CENTER')) return;
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
          '📊 <b>PERFORMANCE</b>',
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
        { parse_mode: 'HTML', reply_markup: backHome('Intelligence', 'INTELLIGENCE_CENTER').reply_markup }
      );
      return;
    }

    await ctx.reply(
      [
        '📊 <b>PERFORMANCE</b>',
        '',
        '<b>Best Calls by High ROI</b>',
        '',
        ...signals.map((s: any, i: number) =>
          [
            `${i + 1}. <b>${escapeTelegramHtml(String(s.symbol ?? 'Unknown'))}</b>`,
            `${escapeTelegramHtml(String(s.title ?? 'AlphaOS Opportunity'))}`,
            '',
            `🚀 ROI High: <b>${fmtRoi(s.roi_high)}</b>`,
            `💰 ROI Now: <b>${fmtRoi(s.roi_now)}</b>`,
            '',
            `🎯 Alert Price: <b>${fmtPrice(s.alert_price)}</b>`,
            `📈 High After Alert: <b>${fmtPrice(s.high_after_alert)}</b>`,
            `📍 Current Price: <b>${fmtPrice(s.current_price)}</b>`,
            '',
            `Status: <b>${resultLabel(s.roi_high)}</b>`,
            `Mint: <code>${escapeTelegramHtml(String(s.token))}</code>`,
          ].join('\n')
        ),
      ].join('\n\n'),
      { parse_mode: 'HTML', reply_markup: backHome('Intelligence', 'INTELLIGENCE_CENTER').reply_markup }
    );
  });

  bot.action(['PREMIUM', 'MEMBERSHIP_HOME'], async (ctx) => {
    clearPaymentInputState(String(ctx.from?.id ?? ''));
    await ctx.answerCbQuery();

    await renderScreen(
      ctx,
      [
        '⭐ <b>MEMBERSHIP</b>',
        '',
        '<b>Free</b> · Explore core opportunities and investigations.',
        '',
        '<b>Pro</b> · Faster intelligence, Watchlist, Wallets, Smart Money, Creators and Performance.',
        '',
        'Payments are reviewed manually before Pro access is activated.',
      ].join('\n'),
      {
        parse_mode:
          'HTML',

        reply_markup:
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '⭐ Compare Plans',
                'MEMBERSHIP_PLANS',
              ),
            ],
            [
              Markup.button.callback(
                '📋 Current Plan',
                'USER_STATUS',
              ),

              Markup.button.callback(
                '💳 Payment Status',
                'PAYMENT_STATUS',
              ),
            ],
            [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
          ]).reply_markup,
      },
    );
  });

  bot.action(['PREMIUM_PLANS', 'MEMBERSHIP_PLANS'], async (ctx) => {
    clearPaymentInputState(String(ctx.from?.id ?? ''));
    await ctx.answerCbQuery();

    await renderScreen(
      ctx,
      [
        '⭐ <b>COMPARE PLANS</b>',
        '',
        '<b>15 Days</b> · 0.1 SOL',
        '<b>30 Days</b> · 0.15 SOL',
        '',
        '<b>Payment destination</b>',
        `<code>${escapeTelegramHtml(config.solanaPaymentWallet || 'Payment wallet unavailable')}</code>`,
        '',
        'Select a plan, send the exact amount, then submit the Solana transaction signature for manual review.',
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
                '⬅️ Membership',
                'MEMBERSHIP_HOME',
              ),

              Markup.button.callback(
                '🏠 Home',
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
      '📋 <b>CURRENT PLAN</b>',
      '',
      `Access: <b>${escapeTelegramHtml(accessProfileForUser(user).label.replace(/^[^ ]+ /, ''))}</b>`,
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
                '⬅️ Membership',
                'MEMBERSHIP_HOME',
              ),

              Markup.button.callback(
                '🏠 Home',
                'MAIN_MENU',
              ),
            ],
          ]).reply_markup,
      },
    );
  });

  bot.action('PAYMENT_STATUS', async ctx => {
    await ctx.answerCbQuery();
    const telegramId = String(ctx.from?.id ?? '');
    try {
      const payment = await getLatestPaymentForUser(telegramId);
      const lines = ['💳 <b>PAYMENT STATUS</b>', ''];
      if (!payment) {
        lines.push('No payment submission found.');
      } else {
        lines.push(
          `Status: <b>${escapeTelegramHtml(String(payment.status ?? 'pending').toUpperCase())}</b>`,
          `Plan: <b>${Number(payment.plan_days)} days</b>`,
          `Amount: <b>${Number(payment.amount_sol)} SOL</b>`,
          '',
          String(payment.status).toLowerCase() === 'pending'
            ? 'Manual verification is in progress.'
            : 'This is your latest payment submission.',
        );
      }
      await renderScreen(ctx, lines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('⬅️ Membership', 'MEMBERSHIP_HOME'),
            Markup.button.callback('🏠 Home', 'MAIN_MENU'),
          ],
        ]).reply_markup,
      });
    } catch (error) {
      console.error('[Membership] Payment status failed:', error);
      await ctx.reply('Unable to load payment status. Please try again.');
    }
  });

  bot.action('SETTINGS', async (ctx) => {
    await ctx.answerCbQuery();
    const access = await getContextAccess(ctx);

    const controlRows: any[][] = [
      [Markup.button.callback('🎯 Alert Strategies', 'STRATEGY_SETTINGS')],
      [Markup.button.callback(
        hasCapability(access, 'wallets.track')
          ? '🐋 Wallet Notifications'
          : '🔒 Wallet Notifications',
        'WALLET_TRACKING',
      )],
      [Markup.button.callback('ℹ️ Help & Safety', 'INTRO')],
    ];
    if (hasCapability(access, 'trading.admin')) {
      controlRows.push([Markup.button.callback('🛡 Trading Controls', 'ADMIN_TRADE_SETTINGS')]);
    }
    controlRows.push([Markup.button.callback('🏠 Home', 'MAIN_MENU')]);

    await renderScreen(
      ctx,
      [
        '⚙️ <b>CONTROLS</b>',
        '',
        'Choose normal alert strategies, wallet notifications, and safety guidance.',
        '',
        'Critical safety alerts may override normal strategy preferences.',
      ].join('\n'),
      {
        parse_mode: 'HTML',

        reply_markup:
          Markup.inlineKeyboard(controlRows).reply_markup,
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
        '⭐ <b>ALPHAOS MEMBERSHIP</b>',
        '',
        '<b>15 Days</b> · 0.1 SOL',
        '<b>30 Days</b> · 0.15 SOL',
        '',
        'Pro includes faster intelligence, Watchlist, Wallets, Smart Money, Creators and Performance.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('⭐ Compare Plans', 'MEMBERSHIP_PLANS')],
          [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
        ]).reply_markup,
      },
    );
  });

  bot.command('upgrade', async (ctx) => {
    const wallet = config.solanaPaymentWallet || 'SET_SOLANA_PAYMENT_WALLET';

    await ctx.reply(
      [
        '⭐ <b>UPGRADE TO PRO</b>',
        '',
        '<b>15 Days</b> · 0.1 SOL',
        '<b>30 Days</b> · 0.15 SOL',
        '',
        '<b>Payment destination</b>',
        `<code>${escapeTelegramHtml(wallet)}</code>`,
        '',
        'Choose a plan, send the exact amount, then submit the transaction signature for manual verification.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('15 Days • 0.1 SOL', 'PLAN_15')],
          [Markup.button.callback('30 Days • 0.15 SOL', 'PLAN_30')],
          [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
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
    await ctx.answerCbQuery();
    await renderSelectedPlan(ctx, 15, 0.1);
  });

  bot.action('PLAN_30', async (ctx) => {
    await ctx.answerCbQuery();
    await renderSelectedPlan(ctx, 30, 0.15);
  });

  bot.action('SUBMIT_PLAN_15', async ctx => {
    try {
      await beginPaymentSubmission(ctx, 15, 0.1);
    } catch (error) {
      console.error('[Membership] Payment submission failed:', error);
      await ctx.answerCbQuery('Unable to start payment submission').catch(() => {});
      await ctx.reply('Unable to start payment submission. Please try again.');
    }
  });
  bot.action('SUBMIT_PLAN_30', async ctx => {
    try {
      await beginPaymentSubmission(ctx, 30, 0.15);
    } catch (error) {
      console.error('[Membership] Payment submission failed:', error);
      await ctx.answerCbQuery('Unable to start payment submission').catch(() => {});
      await ctx.reply('Unable to start payment submission. Please try again.');
    }
  });

  bot.action('UPGRADE_CANCEL', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    clearPaymentInputState(telegramId);
    await ctx.answerCbQuery('Cancelled');
    await sendMainMenu(ctx);
  });

  bot.action(/^ADMIN_BUY_SMALL_(.+)$/, async ctx => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) return ctx.answerCbQuery('Admin only');
    const mint = (ctx.match as RegExpExecArray)[1];
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '⚠️ <b>CONFIRM BUY</b>',
        '',
        `Spend <b>${config.adminBuyAmountSmallSol} SOL</b>`,
        `<code>${escapeTelegramHtml(mint)}</code>`,
        '',
        'This can execute a real trade when live mode is enabled.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Confirm Buy', callback_data: `ABXS_${mint}` }],
          [
            { text: '✖️ Cancel', callback_data: 'TRADE_MENU' },
            { text: '🏠 Home', callback_data: 'MAIN_MENU' },
          ],
        ] },
      },
    );
  });

  bot.action(/^ABXS_(.+)$/, async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    const mint = (ctx.match as RegExpExecArray)[1];
    const actionKey = `${telegramId}:buy-small:${mint}`;
    if (!acquireTradeAction(actionKey)) {
      await ctx.answerCbQuery('This trade action was already submitted');
      return;
    }

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
      releaseTradeAction(actionKey);
      await ctx.reply(`❌ Buy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  bot.action(/^ADMIN_BUY_DEFAULT_(.+)$/, async ctx => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) return ctx.answerCbQuery('Admin only');
    const mint = (ctx.match as RegExpExecArray)[1];
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '⚠️ <b>CONFIRM BUY</b>',
        '',
        `Spend <b>${config.adminBuyAmountDefaultSol} SOL</b>`,
        `<code>${escapeTelegramHtml(mint)}</code>`,
        '',
        'This can execute a real trade when live mode is enabled.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Confirm Buy', callback_data: `ABXD_${mint}` }],
          [
            { text: '✖️ Cancel', callback_data: 'TRADE_MENU' },
            { text: '🏠 Home', callback_data: 'MAIN_MENU' },
          ],
        ] },
      },
    );
  });

  bot.action(/^ABXD_(.+)$/, async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    const mint = (ctx.match as RegExpExecArray)[1];
    const actionKey = `${telegramId}:buy-default:${mint}`;
    if (!acquireTradeAction(actionKey)) {
      await ctx.answerCbQuery('This trade action was already submitted');
      return;
    }

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
      releaseTradeAction(actionKey);
      await ctx.reply(`❌ Buy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  bot.action(/^ADMIN_SELL_(25|50|100)_(.+)$/, async ctx => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) return ctx.answerCbQuery('Admin only');
    const percent = Number((ctx.match as RegExpExecArray)[1]);
    const mint = (ctx.match as RegExpExecArray)[2];
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '⚠️ <b>CONFIRM SELL</b>',
        '',
        `Sell <b>${percent}%</b>`,
        `<code>${escapeTelegramHtml(mint)}</code>`,
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Confirm Sell', callback_data: `ASX${percent}_${mint}` }],
          [
            { text: '✖️ Cancel', callback_data: 'TRADE_MENU' },
            { text: '🏠 Home', callback_data: 'MAIN_MENU' },
          ],
        ] },
      },
    );
  });

  bot.action(/^ASX(25|50|100)_(.+)$/, async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(telegramId)) {
      await ctx.answerCbQuery('Admin only');
      return;
    }

    const percent = Number((ctx.match as RegExpExecArray)[1]) as 25 | 50 | 100;
    const mint = (ctx.match as RegExpExecArray)[2];
    const actionKey = `${telegramId}:sell-${percent}:${mint}`;
    if (!acquireTradeAction(actionKey)) {
      await ctx.answerCbQuery('This trade action was already submitted');
      return;
    }

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
      releaseTradeAction(actionKey);
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

    if (
      getConversationState(telegramId) !== 'SUBMIT_PAYMENT_HASH' ||
      !session?.awaitingTxHash
    ) {
      return next();
    }

    const txHash = ctx.message.text.trim();

    if (txHash.startsWith('/')) {
      if (txHash.toLowerCase() === '/cancel') {
        upgradeSessions.delete(telegramId);
        clearConversationState(telegramId);
        await ctx.reply('Payment submission cancelled.');
        return;
      }
      return next();
    }

    if (!isLikelySolanaSignature(txHash)) {
      await ctx.reply(
        'That does not look like a valid Solana transaction signature. Paste the full signature or choose Cancel.',
        Markup.inlineKeyboard([
          [Markup.button.callback('✖️ Cancel', 'UPGRADE_CANCEL')],
          [Markup.button.callback('⬅️ Membership', 'MEMBERSHIP_HOME')],
        ]),
      );
      return;
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

    clearPaymentInputState(telegramId);

    await ctx.reply(
      [
        '✅ Payment request submitted.',
        '',
        'Your transaction signature is awaiting manual verification.',
        'Pro access begins after approval.',
      ].join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('💳 Payment Status', 'PAYMENT_STATUS')],
        [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
      ]),
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
