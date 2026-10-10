import { upsertUser } from '../core/subscriptions.js';
import { registerTraderTools } from './traderTools.js';
import { alphaosFeatureGuide, alphaosHomeText } from '../product/featureGuide.js';
import { Markup, Telegraf } from 'telegraf';
import { config } from '../config.js';
import { getContextAccess } from './accessControl.js';
import { ALPHAOS_SUBSCRIPTION_PLAN, subscriptionsEnabled, isClosedPaymentEntry, publicSubscriptionStatusText } from '../product/subscriptionPlan.js';
import { rememberRuntimeSubscriber, persistStartedSubscriber } from '../services/runtimeSubscriberRegistry.js';
import { intelligenceMenu, mainAlphaMenu, tradingMenu } from './menus.js';
import { registerAddressScreening } from './addressScreening.js';
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

function dormantMembershipText(): string {
  return [
    '✦ <b>ALPHAOS ACCESS</b>',
    '',
    subscriptionsEnabled() ? '<b>Free</b> · Core alerts and research. Pro tools require active membership.' : '<b>Free</b> · Current testing access while production validation is completed.',
    '',
    `<b>Pro launch plan</b> · $${ALPHAOS_SUBSCRIPTION_PLAN.intro.priceUsdEquivalent} equivalent for the first ${ALPHAOS_SUBSCRIPTION_PLAN.intro.accessDays} days, then $${ALPHAOS_SUBSCRIPTION_PLAN.renewal.priceUsdEquivalent} equivalent every ${ALPHAOS_SUBSCRIPTION_PLAN.renewal.accessDays} days.`,
    '',
    'Payments are <b>not open yet</b>.',
    publicSubscriptionStatusText(),
  ].join('\n');
}

export function createBot(persistSubscriber:typeof upsertUser=upsertUser) {
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
    // Group scans do not enroll every group member into private alert delivery.
    if (telegramId && ctx.chat?.type === 'private') {
      rememberRuntimeSubscriber({
        telegramId,
        username: ctx.from?.username ?? null,
        firstName: ctx.from?.first_name ?? null,
        isAdmin: telegramId === String(config.adminTelegramId),
      });
    }
    return next();
  });

  // Membership access does not enable the unvalidated legacy SOL payment UI.
  bot.use(async (ctx, next) => {
    const callback = String((ctx.callbackQuery as any)?.data ?? '');
    const text = String((ctx.message as any)?.text ?? '').trim();
    if (!isClosedPaymentEntry(callback, text)) return next();

    if (callback) await ctx.answerCbQuery?.('Pro payments are not open yet').catch(() => {});
    await ctx.reply(dormantMembershipText(), {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⌂ Home', 'MAIN_MENU')],
      ]).reply_markup,
    });
    return;
  });

  // Critical navigation must never wait on Supabase. These handlers intentionally
  // run before the legacy DB-backed screens registered below. WALLET_TRACKING is
  // deliberately NOT intercepted here so the full saved-wallet experience remains intact.
  bot.use(async (ctx, next) => {
    const data = String((ctx.callbackQuery as any)?.data ?? '');
    if (!data) return next();

    const access = await getContextAccess(ctx);

    if (data === 'MAIN_MENU') {
      await renderFast(
        ctx,
        alphaosHomeText(),
        mainAlphaMenu(access).reply_markup,
      );
      return;
    }

    if (data === 'OPPORTUNITY_CENTER') {
      await renderFast(ctx, [
        '⚡ <b>ALERTS</b>', '',
        'Boost · DEX Paid · Social Mafia · Protocol Discovery · Qualifying market/setup feeds.', '',
        'Runner cards: 2×, 5×, 10×, 50× and 100× sampled price milestones from tracked alerts. They follow the original feed preference.', '',
        'Choose your feeds in Alert Preferences. Qualifying discovery alerts are released after 30 seconds for Free users; Pro gets priority delivery.',
        'Risk warnings have no added delay. Scan a contract to research a token before acting.', '',
        'Recorded Setups shows the available strategy list; it is not a complete history of every feed.',
      ].join('\n'), Markup.inlineKeyboard([
        [Markup.button.callback('⚙ Alert Preferences', 'STRATEGY_SETTINGS')],
        [Markup.button.callback('📊 Recorded Setups', 'OPP_LIVE_LIST'), Markup.button.callback('🔎 Scan', 'WELCOME_SCAN')],
        [Markup.button.callback('✦ Free / Pro', 'FEATURE_GUIDE'), Markup.button.callback('⌂ Home', 'MAIN_MENU')],
      ]).reply_markup);
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
        access.tier === 'admin' ? [
          '📈 <b>TRADING</b>', '', 'Review opportunities and execution controls.',
          '<i>Automatic trading remains disabled unless explicitly enabled.</i>',
        ].join('\n') : [
          '🎯 <b>TRADER TOOLS</b>', '',
          '1. Screen a Token — send /scan &lt;contract&gt;.',
          '2. Robinchain — open Readiness on the token report.',
          '3. Monitor 1h — follow price/liquidity changes; manage in My Monitors.', '',
          '<b>Readiness &amp; Monitors · Pro</b>',
          'Indexed Robinchain USD pools only. ARC and pre-bond curves are not supported by these tools.',
          'Readiness shows Watch / Setup forming; it does not approve an entry. Monitors check about every 2 minutes and expire after one hour.',
          'Up to 2 tokens per user, 10 tokens overall and 3 warning events per monitor. Stop anytime in My Monitors.',
          'Monitoring is periodic; fast declines can occur between checks.',
          'Curve Estimate is available separately in Full Intel for supported PONS pre-bond tokens.', '',
          subscriptionsEnabled() ? '<i>Research tools; no automatic trades. Pro tools require active membership.</i>' : '<i>Research tools; no automatic trades. Pro tools remain open during testing.</i>',
        ].join('\n'),
        tradingMenu(access).reply_markup,
      );
      return;
    }

    if (data === 'MEMBERSHIP_HOME') {
      await renderFast(
        ctx,
        subscriptionsEnabled()
          ? [
              '✦ <b>ALPHAOS ACCESS</b>',
              '',
              'Free and Pro membership controls.',
            ].join('\n')
          : dormantMembershipText(),
        Markup.inlineKeyboard([
          ...(subscriptionsEnabled() ? [[Markup.button.callback('⭐ Compare Plans', 'MEMBERSHIP_PLANS')]] : []),
          [Markup.button.callback('⌂ Home', 'MAIN_MENU')],
        ]).reply_markup,
      );
      return;
    }

    return next();
  });

  bot.action('FEATURE_GUIDE', async ctx => {
    const access = await getContextAccess(ctx);
    await renderFast(ctx, alphaosFeatureGuide(), mainAlphaMenu(access).reply_markup);
  });

  // Reply without waiting for Supabase, but persist private enrollment in the background.
  bot.use(async (ctx, next) => {
    const text = String((ctx.message as any)?.text ?? '').trim();
    const isStart = /^\/start(?:@\S+)?(?:\s+\S+)?$/.test(text);
    if (!isStart) return next();

    const access = await getContextAccess(ctx);
    const telegramId = String(ctx.from?.id ?? '');
    const isAdmin = telegramId === String(config.adminTelegramId);

    console.log('[TelegramCommand] /start received', { telegramId, isAdmin });
    if(telegramId && ctx.chat?.type==='private') {
      void persistStartedSubscriber({telegramId,username:ctx.from?.username,firstName:ctx.from?.first_name},persistSubscriber)
        .catch(error=>console.warn('[TelegramSubscriber] Private registration failed; runtime enrollment retained.', {
          telegramId,reason:error instanceof Error?error.message:String(error),
        }));
    }


    await ctx.reply(
      alphaosHomeText(),
      {
        parse_mode: 'HTML',
        reply_markup: mainAlphaMenu(access).reply_markup,
      },
    );
    return;
  });

  registerAddressScreening(bot);
  registerBotCommands(bot);
  registerStrategyControls(bot);
  registerOpportunityCenter(bot);
  registerOpportunityActions(bot);
  registerWalletTracking(bot);
  registerIntelligenceCenter(bot);
  registerTokenIntelligenceActions(bot);
  registerTraderTools(bot);
  registerXIntelligenceAdmin(bot);
  return bot;
}
