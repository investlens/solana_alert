import { Markup, Telegraf } from 'telegraf';
import { config } from '../config.js';
import { accessProfileForTier } from '../product/capabilities.js';
import { rememberRuntimeSubscriber } from '../services/runtimeSubscriberRegistry.js';
import { intelligenceMenu, mainAlphaMenu, tradingMenu } from './menus.js';
import { registerBotCommands } from './commands.js';
import { registerStrategyControls } from './strategyControls.js';
import { registerOpportunityCenter } from './opportunityCenter.js';

import {
  registerOpportunityActions,
} from './opportunityActions.js';

import {
  registerWalletTracking,
} from './walletTracking.js';
import { registerIntelligenceCenter } from './intelligenceCenter.js';
import { registerTokenIntelligenceActions } from './tokenIntelligenceActions.js';
import { registerXIntelligenceAdmin } from './xIntelligenceAdmin.js';

function accessForContext(ctx: any) {
  const telegramId = String(ctx.from?.id ?? '');
  return accessProfileForTier(
    telegramId === String(config.adminTelegramId) ? 'admin' : 'free',
  );
}

async function renderFast(ctx: any, text: string, replyMarkup: any) {
  await ctx.answerCbQuery?.().catch(() => {});
  const options = { parse_mode: 'HTML' as const, reply_markup: replyMarkup };
  try {
    await ctx.editMessageText(text, options);
  } catch (error) {
    if (String(error).toLowerCase().includes('message is not modified')) return;
    await ctx.reply(text, options);
  }
}

export function createBot() {
  const bot = new Telegraf(config.botToken);

  bot.catch((error, ctx) => {
    console.error('[TelegramPolling] Handler error contained.', {
      updateType: ctx.updateType,
      telegramId: String(ctx.from?.id ?? ''),
      reason: error instanceof Error ? error.message : String(error),
    });
  });

  bot.use(async (ctx, next) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (telegramId) {
      rememberRuntimeSubscriber({
        telegramId,
        username: ctx.from?.username ?? null,
        firstName: ctx.from?.first_name ?? null,
        isAdmin: telegramId === String(config.adminTelegramId),
      });
    }
    return next();
  });

  // Critical navigation must never wait on Supabase. These handlers intentionally
  // run before the legacy DB-backed screens registered below. WALLET_TRACKING is
  // deliberately NOT intercepted here so the full saved-wallet experience remains intact.
  bot.use(async (ctx, next) => {
    const data = String((ctx.callbackQuery as any)?.data ?? '');
    if (!data) return next();

    const access = accessForContext(ctx);

    if (data === 'MAIN_MENU') {
      await renderFast(
        ctx,
        [
          '🧠 <b>ALPHAOS AI</b>',
          '<i>Crypto Intelligence Terminal</i>',
          '',
          '⚡ Live opportunities',
          '🧠 Developer & smart-money intelligence',
          '🐋 Wallet tracking',
          '📈 Trading workspace',
          '',
          '<i>Navigation remains available even while market data is recovering.</i>',
        ].join('\n'),
        mainAlphaMenu(access).reply_markup,
      );
      return;
    }

    if (data === 'OPPORTUNITY_CENTER') {
      await renderFast(
        ctx,
        [
          '⚡ <b>RADAR</b>',
          '',
          'AlphaOS scanners are running.',
          'Live opportunity data is loaded separately so a database slowdown cannot freeze this screen.',
          '',
          '<i>If the live list is temporarily unavailable, alerts continue to be evaluated by the scanner.</i>',
        ].join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh Radar', 'OPPORTUNITY_CENTER')],
          [Markup.button.callback('🧠 Intelligence', 'INTELLIGENCE_CENTER')],
          [Markup.button.callback('⌂ Home', 'MAIN_MENU')],
        ]).reply_markup,
      );
      return;
    }

    if (data === 'INTELLIGENCE_CENTER') {
      await renderFast(
        ctx,
        [
          '🧠 <b>INTELLIGENCE</b>',
          '',
          'Developer wallets · Smart money · Research · Track record',
          '',
          'Choose an intelligence workspace below.',
        ].join('\n'),
        intelligenceMenu(access).reply_markup,
      );
      return;
    }

    if (data === 'TRADE_MENU') {
      await renderFast(
        ctx,
        [
          '📈 <b>TRADING</b>',
          '',
          'Review opportunities and execution controls.',
          '',
          '<i>Automatic trading remains disabled unless explicitly enabled.</i>',
        ].join('\n'),
        tradingMenu(access).reply_markup,
      );
      return;
    }

    if (data === 'SETTINGS') {
      await renderFast(
        ctx,
        [
          '⚙ <b>CONTROLS</b>',
          '',
          'Alert strategies and preferences.',
          '',
          'Database-backed preference editing is temporarily protected while Supabase recovers.',
        ].join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('🎯 Strategies', 'STRATEGY_SETTINGS')],
          [Markup.button.callback('⌂ Home', 'MAIN_MENU')],
        ]).reply_markup,
      );
      return;
    }

    if (data === 'MEMBERSHIP_HOME') {
      await renderFast(
        ctx,
        [
          '✦ <b>ALPHAOS ACCESS</b>',
          '',
          'Realtime testing access is currently enabled for active users.',
          'Premium packaging will be re-enabled after the production reliability pass.',
        ].join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('⌂ Home', 'MAIN_MENU')],
        ]).reply_markup,
      );
      return;
    }

    return next();
  });

  // /start also stays independent of Supabase.
  bot.use(async (ctx, next) => {
    const text = String((ctx.message as any)?.text ?? '').trim();
    const isStart = text === '/start' || text.startsWith('/start@');
    if (!isStart) return next();

    const access = accessForContext(ctx);
    const telegramId = String(ctx.from?.id ?? '');
    const isAdmin = telegramId === String(config.adminTelegramId);

    console.log('[TelegramCommand] /start received', { telegramId, isAdmin });

    await ctx.reply(
      [
        '🧠 <b>ALPHAOS AI</b>',
        '<i>Crypto Intelligence Terminal</i>',
        '',
        '⚡ Live opportunities',
        '🧠 Developer & smart-money intelligence',
        '🐋 Wallet tracking',
        '📈 Trading workspace',
        '',
        'Choose a workspace below.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: mainAlphaMenu(access).reply_markup,
      },
    );
    return;
  });

  registerBotCommands(bot);
  registerStrategyControls(bot);
  registerOpportunityCenter(bot);
  registerOpportunityActions(bot);
  registerWalletTracking(bot);
  registerIntelligenceCenter(bot);
  registerTokenIntelligenceActions(bot);
  registerXIntelligenceAdmin(bot);
  return bot;
}
