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
