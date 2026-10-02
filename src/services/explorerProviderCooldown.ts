export function createExplorerJsonReader(options: {
  baseUrl: string; timeoutMs: number;
  fetcher?: typeof fetch; clock?: () => number;
}) {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let blockedUntil = 0;
  function assertAvailable() {
    if (clock() < blockedUntil) throw new Error('Blockscout provider cooldown; use live block fallback');
  }
  return {
    assertAvailable,
    async read<T>(path: string): Promise<T> {
      assertAvailable();
      let response: Response;
      try {
        response = await fetcher(`${options.baseUrl}${path}`, {
          headers: { accept: 'application/json' }, signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) { blockedUntil = clock() + 30_000; throw error; }
      if (!response.ok) {
        if (response.status === 403) blockedUntil = clock() + 300_000;
        else if (response.status === 429) {
          const retrySeconds = Number(response.headers.get('retry-after'));
          blockedUntil = clock() + Math.max(30_000, Math.min(300_000, retrySeconds > 0 ? retrySeconds * 1_000 : 60_000));
        } else if (response.status >= 500) blockedUntil = clock() + 30_000;
        throw new Error(`Blockscout HTTP ${response.status}`);
      }
      return await response.json() as T;
    },
  };
}
