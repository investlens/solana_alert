export function createArcRpcScheduler(options: { gapMs?: number; capacity?: number; maxWaitMs?: number;
  now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let tail: Promise<unknown> = Promise.resolve(); let pending = 0; let nextAt = 0;
  return async function schedule<T>(work: () => Promise<T>): Promise<T> {
    if (pending >= (options.capacity ?? 32)) throw new Error('Arc RPC queue capacity reached');
    const admitted = now(); pending++;
    const task = tail.catch(() => {}).then(async () => {
      const wait = Math.max(0, nextAt - now());
      if (now() - admitted + wait > (options.maxWaitMs ?? 8_000)) throw new Error('Arc RPC queue wait expired');
      if (wait) await sleep(wait);
      nextAt = now() + (options.gapMs ?? 200);
      return work();
    });
    tail = task;
    try { return await task; } finally { pending--; }
  };
}

export function isArcProviderFailure(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  // A token revert/empty return is not evidence that the RPC provider is down.
  return /exceeds defined limit|rate.?limit|\b429\b|too many requests|fetch failed|network|socket|ECONN|timed? ?out|timeout|HTTP.*\b5\d\d\b|service unavailable|upstream/i.test(text);
}
export function isArcRateLimit(error: unknown): boolean {
  return /exceeds defined limit|rate.?limit|\b429\b|too many requests/i.test(error instanceof Error ? error.message : String(error));
}
