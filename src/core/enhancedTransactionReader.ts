// Ephemeral, bounded coalescing for wallet polling. Unknown responses never
// become evidence; a provider-wide 429 must cool down all wallet requests.
export function createEnhancedTransactionReader<T>(apiKey: () => string | undefined,
  request: typeof fetch = (input, init) => fetch(input, init), now = Date.now) {
  const cache = new Map<string, { expires: number; value: T[] }>();
  const pending = new Map<string, Promise<T[]>>();
  let backoffUntil = 0;
  let throttles = 0;
  return async (address: string, limit = 50): Promise<T[]> => {
    if (!apiKey()) return [];
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 100)) : 50;
    const key = `${address}:${safeLimit}`;
    for (const [id, item] of cache) if (item.expires <= now()) cache.delete(id);
    const cached = cache.get(key);
    if (cached) return cached.value;
    const running = pending.get(key);
    if (running) return running;
    if (now() < backoffUntil || pending.size >= 2) return [];
    const work = (async (): Promise<T[]> => {
      try {
        const response = await request(`https://api-mainnet.helius-rpc.com/v0/addresses/${encodeURIComponent(address)}/transactions?api-key=${apiKey()}&limit=${safeLimit}`,
          { signal: AbortSignal.timeout(10_000) });
        if (response.status === 429) {
          throttles = Math.min(4, throttles + 1);
          const header = response.headers.get('retry-after');
          const seconds = header === null ? NaN : Number(header);
          const retryMs = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - now() : 0;
          const cooldown = Math.min(3_600_000, Math.max(300_000 * 2 ** (throttles - 1), Number.isFinite(retryMs) ? retryMs : 0));
          backoffUntil = now() + cooldown;
          console.warn(`[HeliusEnhancedTx] RATE_LIMIT cooldownMs=${cooldown}`);
          return [];
        }
        if (!response.ok) return [];
        const value: unknown = await response.json();
        if (!Array.isArray(value)) return [];
        throttles = 0;
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: now() + 15_000, value });
        return value;
      } catch {
        // Do not expose request URLs/API credentials through fetch errors.
        return [];
      }
    })().finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  };
}
