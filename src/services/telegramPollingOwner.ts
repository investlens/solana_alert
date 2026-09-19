import { createClient, type RedisClientType } from 'redis';

let pollingClaimed = false;
let lockClient: RedisClientType | null = null;
const serviceId = process.env.RAILWAY_SERVICE_ID ?? 'local';
const ownerId = `${serviceId}:${process.pid}`;
const lockKey = 'alphaos:telegram:polling-owner';
const ownerServiceKey = 'alphaos:telegram:polling-owner-service';

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
    let acquired = await lockClient.set(lockKey, ownerId, { NX: true, EX: 30 });
    if (acquired !== 'OK') {
      // Railway may restart the same service before the old 30s lease expires.
      // A stale lease from THIS service must not leave /start and callbacks dead.
      const priorService = await lockClient.get(ownerServiceKey);
      if (priorService === serviceId) {
        await lockClient.del(lockKey);
        acquired = await lockClient.set(lockKey, ownerId, { NX: true, EX: 30 });
        if (acquired === 'OK') console.log('[TelegramPolling] Reclaimed stale same-service polling lease.');
      }
    }
    if (acquired !== 'OK') return false;
    await lockClient.set(ownerServiceKey, serviceId, { EX: 120 });
    pollingClaimed = true;
    const refresh = setInterval(async () => {
      try {
        if (!lockClient?.isOpen) return;
        const current = await lockClient.get(lockKey);
        if (current === ownerId) {
          await lockClient.expire(lockKey, 30);
          await lockClient.set(ownerServiceKey, serviceId, { EX: 120 });
        }
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
