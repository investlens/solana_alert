import { createClient, type RedisClientType } from 'redis';

let pollingClaimed = false;
let lockClient: RedisClientType | null = null;
const ownerId = `${process.env.RAILWAY_SERVICE_ID ?? 'local'}:${process.pid}`;
const lockKey = 'alphaos:telegram:polling-owner';

export async function claimTelegramPollingOwner(): Promise<boolean> {
  if (pollingClaimed) return false;
  const url = process.env.REDIS_URL?.trim();
  if (!url || String(process.env.TELEGRAM_POLLING_LOCK_ENABLED ?? 'true').toLowerCase() !== 'true') {
    pollingClaimed = true;
    return true;
  }
  try {
    lockClient ??= createClient({ url });
    lockClient.on('error', error => console.warn('[TelegramPolling] Redis owner lock error:', error instanceof Error ? error.message : String(error)));
    if (!lockClient.isOpen) await lockClient.connect();
    const acquired = await lockClient.set(lockKey, ownerId, { NX: true, EX: 30 });
    if (acquired !== 'OK') return false;
    pollingClaimed = true;
    const refresh = setInterval(async () => {
      try {
        if (!lockClient?.isOpen) return;
        const current = await lockClient.get(lockKey);
        if (current === ownerId) await lockClient.expire(lockKey, 30);
      } catch {}
    }, 10_000);
    refresh.unref?.();
    return true;
  } catch (error) {
    console.warn('[TelegramPolling] Redis owner lock unavailable; fail-open:', error instanceof Error ? error.message : String(error));
    pollingClaimed = true;
    return true;
  }
}

export function resetTelegramPollingOwnerForTests(): void {
  pollingClaimed = false;
}
