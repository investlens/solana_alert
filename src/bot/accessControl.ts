import { subscriptionsEnabled } from '../product/subscriptionPlan.js';
import { getUserByTelegramId } from '../core/subscriptions.js';
import { Markup } from 'telegraf';
import { config } from '../config.js';
import {
  accessProfileForTier,
  accessProfileForUser,
  CAPABILITY_BENEFITS,
  hasCapability,
  type AccessProfile,
  type Capability,
} from '../product/capabilities.js';

// Resolve membership only when commercial access is enabled. Cache bounded user
// membership evidence briefly; expiry is re-evaluated on every access check.
const membershipCache = new Map<string, { expires: number; user: any }>();
const membershipInflight = new Map<string, Promise<any>>();
export async function getContextAccess(ctx: any): Promise<AccessProfile> {
  const telegramId = String(ctx.from?.id ?? '');
  if (telegramId && telegramId === String(config.adminTelegramId)) return accessProfileForTier('admin');
  if (!subscriptionsEnabled() || !telegramId) return accessProfileForTier('free');
  const now = Date.now();
  for (const [key, value] of membershipCache) if (value.expires <= now) membershipCache.delete(key);
  const cached = membershipCache.get(telegramId);
  if (cached) return accessProfileForUser(cached.user);
  if (membershipInflight.size >= 10 && !membershipInflight.has(telegramId)) return accessProfileForTier('free');
  let lookup = membershipInflight.get(telegramId);
  if (!lookup) {
    lookup = getUserByTelegramId(telegramId).then(user => {
      if (membershipCache.size >= 500) membershipCache.delete(membershipCache.keys().next().value!);
      membershipCache.set(telegramId, { user: user ? { tier: user.tier,
        subscription_status: user.subscription_status, paid_active_until: user.paid_active_until } : null,
        expires: Date.now() + 30_000 });
      return user;
    }).catch(() => null).finally(() => membershipInflight.delete(telegramId));
    membershipInflight.set(telegramId, lookup);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const user = await Promise.race([lookup, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1_000); })]);
    return accessProfileForUser(user);
  } finally { if (timer) clearTimeout(timer); }
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
