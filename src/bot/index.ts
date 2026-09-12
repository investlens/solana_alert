import { Telegraf } from 'telegraf';
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

  // Acknowledge /start immediately, before handlers that depend on Supabase.
  // This keeps Telegram visibly alive even when persistence is degraded.
  bot.use(async (ctx, next) => {
    const text = String((ctx.message as any)?.text ?? '').trim();
    if (text === '/start' || text.startsWith('/start@')) {
      try {
        await ctx.reply('🧠 AlphaOS is online. Loading your workspace…');
      } catch (error) {
        console.warn('[TelegramPolling] Immediate /start acknowledgement failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return next();
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
