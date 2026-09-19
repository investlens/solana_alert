import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let connecting: Promise<void> | null = null;
let disabledUntil = 0;

async function getClient(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url || Date.now() < disabledUntil) return null;
  if (!client) {
    client = createClient({ url });
    client.on('error', (error) => console.warn('[SharedCache] Redis unavailable; fail-open:', error instanceof Error ? error.message : String(error)));
  }
  if (!client.isOpen) {
    try {
      connecting ??= client.connect().then(() => undefined).finally(() => { connecting = null; });
      await Promise.race([connecting, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis connect timeout')), 500))]);
    } catch {
      disabledUntil = Date.now() + 30_000;
      return null;
    }
  }
  return client;
}

export async function getSharedJson<T>(key: string): Promise<{ value: T; fetchedAt: string } | null> {
  try {
    const redis = await getClient();
    if (!redis) return null;
    const raw = await Promise.race([redis.get(key), new Promise<null>((resolve) => setTimeout(() => resolve(null), 150))]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value: T; fetchedAt: string };
    return parsed?.fetchedAt ? parsed : null;
  } catch { return null; }
}

export async function setSharedJson(key: string, value: unknown, fetchedAt: string, ttlMs: number): Promise<void> {
  if (ttlMs <= 0) return;
  try {
    const redis = await getClient();
    if (!redis) return;
    await Promise.race([redis.set(key, JSON.stringify({ value, fetchedAt }), { PX: ttlMs }), new Promise<void>((resolve) => setTimeout(resolve, 150))]);
  } catch { /* Fail open: live market data never depends on Redis. */ }
}
