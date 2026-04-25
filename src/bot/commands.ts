import { Markup, Telegraf } from 'telegraf';
import { config } from '../config.js';
import { adminBuyToken, adminSellTokenPercent } from '../core/adminTrading.js';
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
import { backToMainMenu, mainAlphaMenu } from './menus.js';

const upgradeSessions = new Map<string, PendingUpgradeSession>();

function isAdmin(telegramId: string) {
  return telegramId === config.adminTelegramId;
}

function formatDate(value?: string | null) {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString('en-IN', { hour12: true });
}

async function sendMainMenu(ctx: any) {
  const telegramId = String(ctx.from?.id ?? '');
  const user = await getUserByTelegramId(telegramId);
  const tier = String(user?.tier ?? 'free').toUpperCase();

  await ctx.reply(
    [
  '⚡ <b>ALPHA RADAR</b>',
  '',
  '<b>Smart Money. Early Signals. Faster Conviction.</b>',
  '',
  `Tier: <b>${tier}</b>`,
  user?.tier === 'admin'
    ? 'Access: <b>Admin Alpha Terminal</b>'
    : '🎁 <b>48 Hour Premium Trial Active</b>',
  '',
  user?.tier === 'admin'
    ? 'Instant admin access enabled.'
    : 'You currently have instant Alpha Alerts, Whale Radar access, and DEX Paid signals.',
  '',
  user?.tier === 'admin'
    ? ''
    : 'After 48 hours, free delayed alerts continue. Upgrade anytime for unlimited instant alpha.',
  '',
  'Choose a module below:',
].filter(Boolean).join('\n'),
    {
      parse_mode: 'HTML',
      ...mainAlphaMenu(),
    }
  );
}

export function registerBotCommands(bot: Telegraf<any>) {
  bot.start(async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const username = ctx.from?.username;
    const firstName = ctx.from?.first_name;

    await upsertUser({ telegramId, username, firstName });
    await sendMainMenu(ctx);
  });

  bot.action('MAIN_MENU', async (ctx) => {
    await ctx.answerCbQuery();
    await sendMainMenu(ctx);
  });

  bot.action('ALPHA_FEED', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🚀 <b>Alpha Feed</b>',
        '',
        'Live signal streams:',
        '',
        '💎 DEX Paid Early Runners',
        '🐋 Whale Wallet Buys',
        '🐋🐋 Whale Cluster Buys',
        '🧠 Proven Creator Launches',
        '⚡ Momentum Spikes',
        '',
        'Each signal will show conviction, risk, and reason.',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.action('DEX_PAID', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '💎 <b>DEX Paid Radar</b>',
        '',
        'Tracks tokens where DEX visibility is paid/boosted and momentum begins forming.',
        '',
        'Coming next:',
        '• Fresh paid listings',
        '• Early liquidity runners',
        '• Volume spike confirmation',
        '• Alpha score label',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
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
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.action('CREATOR_INTEL', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🧠 <b>Creator Intel</b>',
        '',
        'Future premium engine:',
        '',
        '• Creators with past $1M+ launches',
        '• Repeat winner wallets',
        '• Creator reputation score',
        '• Rug/farm creator blacklist',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.action('TRADE_MENU', async (ctx) => {
    await ctx.answerCbQuery();

    const telegramId = String(ctx.from?.id ?? '');
    const admin = isAdmin(telegramId);

    await ctx.reply(
      [
        '⚡ <b>Trade Terminal</b>',
        '',
        admin
          ? 'Admin trading is enabled for the configured trading wallet only.'
          : 'Public trading wallet integration is coming later. For now, use chart/buy links from alerts.',
        '',
        'Safety note: Alpha Radar will not ask public users to paste private keys in Telegram chat.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: admin
            ? [
                [
                  { text: 'Buy 0.03 SOL', callback_data: 'TRADE_INFO' },
                  { text: 'Buy 0.05 SOL', callback_data: 'TRADE_INFO' },
                ],
                [
                  { text: 'Sell 25%', callback_data: 'TRADE_INFO' },
                  { text: 'Sell All', callback_data: 'TRADE_INFO' },
                ],
                [{ text: '⬅️ Main Menu', callback_data: 'MAIN_MENU' }],
              ]
            : [[{ text: '⬅️ Main Menu', callback_data: 'MAIN_MENU' }]],
        },
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
        'Coming soon:',
        '• Open positions',
        '• Entry price',
        '• Current value',
        '• PnL',
        '• Exit buttons',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.action('SNIPER', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '🎯 <b>Sniper</b>',
        '',
        'Planned modules:',
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
        'Planned:',
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

  bot.action('PREMIUM', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '👑 <b>Alpha Radar Premium</b>',
        '',
        '<b>Free</b>',
        '• Delayed / limited signals',
        '• 1x future Alpha Points',
        '',
        '<b>Pro</b>',
        '• Faster signals',
        '• Whale Radar',
        '• Creator Intel',
        '• Higher points multiplier',
        '',
        '<b>VIP</b>',
        '• Highest conviction feed',
        '• Advanced tools',
        '• Priority alpha access',
        '',
        'Use /upgrade to activate paid access.',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.action('SETTINGS', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        '⚙ <b>Settings</b>',
        '',
        'Coming soon:',
        '• Alert sensitivity',
        '• Signal categories',
        '• Wallet watchlist',
        '• Risk profile',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
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
        'For safety, Alpha Radar will not ask public users to paste private keys in Telegram chat.',
        '',
        'Admin trading uses a separate configured trading wallet only.',
      ].join('\n'),
      { parse_mode: 'HTML', ...backToMainMenu() }
    );
  });

  bot.command('plans', async (ctx) => {
    await ctx.reply(
      [
        '👑 *Alpha Radar Plans*',
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
        '👑 *Upgrade Alpha Radar*',
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
    const lines = ['📋 *Alpha Radar Status*', '', `*Tier:* ${tier}`];

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
        '📊 *Alpha Radar Stats*',
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
          '✅ Your Alpha Radar membership is now active.',
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

      const trade = await adminSellTokenPercent({
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