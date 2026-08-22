import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { registerBotCommands } from './commands.js';
import { registerStrategyControls } from './strategyControls.js';
import { registerOpportunityCenter } from './opportunityCenter.js';

export function createBot() {
  const bot = new Telegraf(config.botToken);
  registerBotCommands(bot);
  registerStrategyControls(bot);
  registerOpportunityCenter(bot);
  return bot;
}