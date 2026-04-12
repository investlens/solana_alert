import { Markup, Telegraf } from 'telegraf';
import { config } from '../config.js';
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

const upgradeSessions = new Map<string, PendingUpgradeSession>();

function isAdmin(telegramId: string) {
  return telegramId === config.adminTelegramId;
}

function formatDate(value?: string | null) {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString('en-IN', { hour12: true });
}

export function registerBotCommands(bot: Telegraf) {
  bot.start(async (ctx) => {
  const telegramId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;

  await upsertUser({ telegramId, username, firstName });
  const user = await getUserByTelegramId(telegramId);

  const lines = [
    '⚡ *Welcome to Solana Alert Bot*',
    '',
    'Curated early momentum alerts with tier-based timing.',
    '',
    `*Your tier:* ${String(user?.tier ?? 'free').toUpperCase()}`,
  ];

  if (user?.tier === 'admin') {
    lines.push(`*Access:* Full admin control`);
    lines.push(`*Priority:* Instant alerts`);
  } else {
    lines.push(`*Free trial:* ${user?.free_trial_used ?? 0}/${user?.free_trial_limit ?? 5} fast alerts used`);
    lines.push('');
    lines.push('Use /plans to view pricing.');
    lines.push('Use /upgrade to activate paid access.');
  }

  lines.push('');
  lines.push('Use /status to check your membership.');

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

  bot.command('plans', async (ctx) => {
    await ctx.reply(
      [
        '💎 *Paid Plans*',
        '',
        '*15 Days* — `0.1 SOL`',
        '*30 Days* — `0.15 SOL`',
        '',
        '*Free*',
        '• First 5 alerts fast',
        '• After that delayed alerts',
        '',
        '*Paid*',
        '• Earlier alerts',
        '• Better timing edge',
        '• Premium access',
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
        '💎 *Upgrade to Paid*',
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

  const lines = ['📋 *Your Status*', '', `*Tier:* ${tier}`];

  if (user.tier === 'admin') {
    lines.push(`*Access:* Full`);
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
        '📊 *Solana Alert Bot Stats*',
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
          '✅ Your paid membership is now active.',
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
      [
        '✅ Plan selected: *15 days*',
        'Amount: `0.1 SOL`',
        '',
        'Now paste your transaction hash.',
      ].join('\n'),
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
      [
        '✅ Plan selected: *30 days*',
        'Amount: `0.15 SOL`',
        '',
        'Now paste your transaction hash.',
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
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