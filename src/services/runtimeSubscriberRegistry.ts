type RuntimeSubscriber = {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  isAdmin: boolean;
  lastSeenAt: number;
};

const subscribers = new Map<string, RuntimeSubscriber>();

export function rememberRuntimeSubscriber(args: {
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  isAdmin?: boolean;
}) {
  const telegramId = String(args.telegramId ?? '').trim();
  if (!telegramId) return;

  subscribers.set(telegramId, {
    telegramId,
    username: args.username ?? null,
    firstName: args.firstName ?? null,
    isAdmin: Boolean(args.isAdmin),
    lastSeenAt: Date.now(),
  });
}

export function runtimeDeliverableUsers(options?: { allRealtime?: boolean }) {
  const allRealtime = Boolean(options?.allRealtime);

  return [...subscribers.values()].map((subscriber) => ({
    telegram_id: subscriber.telegramId,
    username: subscriber.username,
    first_name: subscriber.firstName,
    tier: subscriber.isAdmin ? 'admin' : allRealtime ? 'paid' : 'free',
    subscription_status: subscriber.isAdmin || allRealtime ? 'active' : 'none',
    free_trial_used: 0,
    free_trial_limit: 5,
    paid_active_until: null,
    is_blocked: false,
  }));
}
