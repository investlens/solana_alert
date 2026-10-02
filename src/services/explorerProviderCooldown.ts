export function createExplorerJsonReader(options: {
  baseUrl: string; timeoutMs: number;
  fetcher?: typeof fetch; clock?: () => number;
}) {
  const clock = options.clock ?? Date.now;
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let blockedUntil = 0;
  const cached = new Map<string, { expires: number; response: Response }>();
  const pending = new Map<string, Promise<Response>>();
  function assertAvailable() {
    if (clock() < blockedUntil) throw new Error('Blockscout provider cooldown; use live block fallback');
  }
  async function responseFor(path: string, signal?: AbortSignal): Promise<Response> {
    path = path.replace(/0x[a-fA-F0-9]{40}/g, value => value.toLowerCase());
    signal?.throwIfAborted();
    const hit = cached.get(path);
    if (hit && hit.expires > clock()) return hit.response.clone();
    if (pending.has(path)) return (await pending.get(path)!).clone();
    const work = (async () => {
      assertAvailable();
      if (pending.size >= 1) throw new Error('Blockscout request capacity reached');
      let response: Response;
      try {
        response = await fetcher(`${options.baseUrl}${path}`, {
          headers: { accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]) : AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) { blockedUntil = clock() + 30_000; throw error; }
      if (!response.ok) {
        if (response.status === 403) blockedUntil = clock() + 300_000;
        else if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const seconds = Number(retry);
          const until = retry ? Date.parse(retry) : NaN;
          const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : Number.isFinite(until) ? until - clock() : 60_000;
          blockedUntil = clock() + Math.max(30_000, delay);
        } else if (response.status >= 500) blockedUntil = clock() + 30_000;
        throw new Error(`Blockscout HTTP ${response.status}`);
      }
      // Retain bounded JSON only; HTML/challenge responses are never cached.
      if (!(response.headers.get('content-type') ?? '').includes('json')) throw new Error('Blockscout non-JSON response');
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > 250_000) throw new Error('Blockscout response exceeds cache budget');
      JSON.parse(body);
      const saved = new Response(body, { headers: { 'content-type': 'application/json' } });
      if (cached.size >= 8) cached.delete(cached.keys().next().value!);
      cached.set(path, { expires: clock() + 30_000, response: saved });
      return saved;
    })();
    pending.set(path, work);
    try { return (await work).clone(); } finally { pending.delete(path); }
  }
  return { assertAvailable, response: responseFor,
    async read<T>(path: string): Promise<T> { return await (await responseFor(path)).json() as T; } };
}
