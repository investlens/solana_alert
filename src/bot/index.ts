import { Markup, Telegraf } from 'telegraf';
import { config } from '../config.js';
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

  // /start must remain available even if Supabase is degraded.
  // Handle it before any database-backed command registration and do not
  // pass the update into the legacy /start handler.
  bot.use(async (ctx, next) => {
    const text = String((ctx.message as any)?.text ?? '').trim();
    const isStart = text === '/start' || text.startsWith('/start@');

    if (!isStart) {
      return next();
    }

    const webUrl = String(process.env.ALPHAOS_WEB_URL ?? '').trim();
    const rows: any[][] = [];

    if (webUrl) {
      rows.push([Markup.button.url('🌐 Open AlphaOS', webUrl)]);
    }

    await ctx.reply(
      [
        '🧠 <b>ALPHAOS</b>',
        '',
        '✅ Telegram: Online',
        '✅ Market scanners: Running',
        '✅ Alert engine: Running',
        '⚠️ Data workspace: Temporarily degraded',
        '',
        'AlphaOS will continue monitoring markets and sending qualifying alerts while the data layer recovers.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        ...(rows.length > 0
          ? { reply_markup: Markup.inlineKeyboard(rows).reply_markup }
          : {}),
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
