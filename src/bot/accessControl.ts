import { Markup } from 'telegraf';
import { config } from '../config.js';
import {
  accessProfileForTier,
  CAPABILITY_BENEFITS,
  hasCapability,
  type AccessProfile,
  type Capability,
} from '../product/capabilities.js';

/**
 * Telegram navigation must remain usable during database degradation.
 * In the current tester model FREE and PRO intentionally expose the same
 * product capabilities; only the configured admin identity needs a special
 * profile. Subscription/database reads belong inside the data action itself,
 * not on every button press.
 */
export async function getContextAccess(ctx: any): Promise<AccessProfile> {
  const telegramId = String(ctx.from?.id ?? '');
  const isAdmin = telegramId !== '' && telegramId === String(config.adminTelegramId);
  return accessProfileForTier(isAdmin ? 'admin' : 'free');
}

export async function requireCapability(
  ctx: any,
  capability: Capability,
  parentCallback = 'MAIN_MENU',
): Promise<AccessProfile | null> {
  const access = await getContextAccess(ctx);
  if (hasCapability(access, capability)) return access;

  await ctx.answerCbQuery?.('Available with AlphaOS Pro', {
    show_alert: false,
  }).catch(() => {});

  await ctx.reply(
    [
      '🔒 <b>ALPHAOS PRO</b>',
      '',
      CAPABILITY_BENEFITS[capability],
      '',
      'Upgrade to unlock this capability.',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⭐ Compare Plans', 'MEMBERSHIP_PLANS')],
        [
          Markup.button.callback('⬅️ Back', parentCallback),
          Markup.button.callback('🏠 Home', 'MAIN_MENU'),
        ],
      ]).reply_markup,
    },
  );

  return null;
}
