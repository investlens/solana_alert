import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { registerBotCommands } from './commands.js';

export function createBot() {
  const bot = new Telegraf(config.botToken);
  registerBotCommands(bot);
  return bot;
}