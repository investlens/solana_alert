import { Markup } from 'telegraf';
import { getUserByTelegramId } from '../core/subscriptions.js';
import {
  accessProfileForUser,
  CAPABILITY_BENEFITS,
  hasCapability,
  type AccessProfile,
  type Capability,
} from '../product/capabilities.js';

export async function getContextAccess(ctx: any): Promise<AccessProfile> {
  const telegramId = String(ctx.from?.id ?? '');
  const user = telegramId ? await getUserByTelegramId(telegramId) : null;
  return accessProfileForUser(user);
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
