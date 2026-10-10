type RuntimeSubscriber = {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  isAdmin: boolean;
  lastSeenAt: number;
};

const subscribers = new Map<string, RuntimeSubscriber>();
const rejected = new Set<string>();

export function rememberRuntimeSubscriber(args: {
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  isAdmin?: boolean;
}) {
  const telegramId = String(args.telegramId ?? '').trim();
  if (!telegramId) return;

  rejected.delete(telegramId);
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

// An explicit Telegram rejection must also remove the in-memory fallback recipient.
export function forgetRuntimeSubscriber(telegramId: string): void {
  subscribers.delete(String(telegramId));
  rejected.add(String(telegramId));
  while(rejected.size>5000)rejected.delete(rejected.values().next().value!);
}

// A just-started user must be included even before a database read catches up.
// Keep persisted paid access; a runtime interaction only reactivates delivery.
export function mergeRuntimeSubscribers<T extends {telegram_id:string;is_blocked:boolean}>(rows:T[]): T[] {
  const merged = new Map<string,T>(rows.map(row => [String(row.telegram_id),row]));
  for (const runtime of runtimeDeliverableUsers()) {
    const existing = merged.get(runtime.telegram_id);
    merged.set(runtime.telegram_id, existing ? {...existing,is_blocked:false} : runtime as unknown as T);
  }
  return [...merged.values()].filter(row => !row.is_blocked && !rejected.has(String(row.telegram_id)));
}

export async function persistStartedSubscriber<T>(args:T, persist:(args:T)=>Promise<unknown>, wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))):Promise<void> {
  for (let attempt=0;attempt<3;attempt++) {
    try { await persist(args); return; }
    catch(error) { if(attempt===2)throw error; await wait(attempt===0?1000:5000); }
  }
}
