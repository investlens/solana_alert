import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { registerBotCommands } from './commands.js';
import { registerStrategyControls } from './strategyControls.js';

export function createBot() {
  const bot = new Telegraf(config.botToken);
  registerBotCommands(bot);
  registerStrategyControls(bot);
  return bot;
}