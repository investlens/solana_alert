import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { accessProfileForTier } from '../product/capabilities.js';
import { mainAlphaMenu } from './menus.js';
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

export function createBot() {
  const bot = new Telegraf(config.botToken);

  // A database-backed command/callback must never terminate Telegram polling.
  bot.catch((error, ctx) => {
    console.error('[TelegramPolling] Handler error contained.', {
      updateType: ctx.updateType,
      telegramId: String(ctx.from?.id ?? ''),
      reason: error instanceof Error ? error.message : String(error),
    });
  });

  // Keep the real AlphaOS home available even when the data layer is degraded.
  // Admin identity comes from Railway config, so this path requires no database read.
  bot.use(async (ctx, next) => {
    const text = String((ctx.message as any)?.text ?? '').trim();
    const isStart = text === '/start' || text.startsWith('/start@');
    if (!isStart) return next();

    const telegramId = String(ctx.from?.id ?? '');
    const isAdmin = telegramId === String(config.adminTelegramId);
    const access = accessProfileForTier(isAdmin ? 'admin' : 'free');

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
