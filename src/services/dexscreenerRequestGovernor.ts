export type DexScreenerPriority = 'HIGH' | 'NORMAL' | 'BACKGROUND';

export type GovernedDexScreenerValue<T> = {
  value: T;
  fetchedAt: string;
  source: 'DEXSCREENER';
  cache: 'MISS' | 'HIT' | 'INFLIGHT';
};

export class DexScreenerProviderBackoffError extends Error {
  readonly code = 'DEXSCREENER_BACKOFF';
  constructor(readonly backoffUntil: number) {
    super(`DexScreener provider backoff active until ${new Date(backoffUntil).toISOString()}`);
    this.name = 'DexScreenerProviderBackoffError';
  }
}

type QueueEntry = { priority: DexScreenerPriority; run: (recoveryProbe: boolean) => void; reject: (error: unknown) => void };
type CacheEntry = { expiresAt: number; fetchedAt: string; value: unknown };
type GovernorDependencies = { fetch: typeof fetch; now: () => number; random: () => number };

const DEFAULT_MAX_CONCURRENCY = 2;
export const DEXSCREENER_REQUESTS_PER_SECOND = 2;
const FALLBACK_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const ACTIVITY_LOG_INTERVAL_MS = 15_000;
const queues: Record<DexScreenerPriority, QueueEntry[]> = { HIGH: [], NORMAL: [], BACKGROUND: [] };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<GovernedDexScreenerValue<unknown>>>();
let dependencies: GovernorDependencies = { fetch: globalThis.fetch, now: Date.now, random: Math.random };
let activeRequests = 0;
let maximumConcurrency = DEFAULT_MAX_CONCURRENCY;
let requestsPerSecond = DEXSCREENER_REQUESTS_PER_SECOND;
let availableRequestTokens = DEXSCREENER_REQUESTS_PER_SECOND;
let lastTokenRefillAt = dependencies.now();
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let providerBackoffUntil = 0;
let consecutiveRateLimits = 0;
let recoveryRequired = false;
let recoveryProbeInFlight = false;
let normalSinceBackground = 0;
let highSinceLower = 0;
let lastBackoffActiveLogAt = 0;
let lastActivityLogAt = Number.NEGATIVE_INFINITY;
const counters = { requests: 0, cacheHits: 0, inflightHits: 0, backoffPrevented: 0, rateLimited: 0 };

function log(status: string, fields: Record<string, unknown> = {}) {
  console.log('dexscreener_governor', { event: 'dexscreener_governor', status, ...fields,
    queueDepth: queues.HIGH.length + queues.NORMAL.length + queues.BACKGROUND.length, activeRequests });
}

function logActivity(caller: string, endpoint: string, priority: DexScreenerPriority) {
  const now = dependencies.now();
  if (now - lastActivityLogAt < ACTIVITY_LOG_INTERVAL_MS) return;
  lastActivityLogAt = now;
  log('ACTIVITY_SUMMARY', { caller, endpoint, priority, ...counters });
}

function retryAfterMs(response: Response, body: string): number | null {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - dependencies.now());
  }
  try {
    const seconds = Number((JSON.parse(body) as { retry_after?: unknown }).retry_after);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  } catch { /* non-JSON provider response */ }
  return null;
}

function enterBackoff(response: Response, body: string, caller: string, endpoint: string) {
  consecutiveRateLimits += 1;
  const advised = retryAfterMs(response, body);
  const fallback = Math.min(MAX_BACKOFF_MS, FALLBACK_BACKOFF_MS * 2 ** Math.min(4, consecutiveRateLimits - 1));
  const base = Math.min(MAX_BACKOFF_MS, Math.max(1_000, advised ?? fallback));
  const jitter = advised == null ? Math.floor(Math.min(MAX_BACKOFF_MS - base, base * 0.1 * dependencies.random())) : 0;
  providerBackoffUntil = Math.max(providerBackoffUntil, dependencies.now() + base + jitter);
  recoveryRequired = false;
  recoveryProbeInFlight = false;
  counters.rateLimited += 1;
  log('RATE_LIMITED', { caller, endpoint, retryAfterSeconds: Math.ceil((base + jitter) / 1000) });
  log('BACKOFF_ENTERED', { caller, endpoint, backoffUntil: new Date(providerBackoffUntil).toISOString(),
    retryAfterSeconds: Math.ceil((base + jitter) / 1000) });
}

function activeBackoff(): number | null {
  const now = dependencies.now();
  if (providerBackoffUntil > now) return providerBackoffUntil;
  if (providerBackoffUntil) {
    providerBackoffUntil = 0;
    recoveryRequired = true;
    log('RECOVERY_PROBE_READY');
  }
  return null;
}

function refillRequestTokens() {
  if (!Number.isFinite(requestsPerSecond)) { availableRequestTokens = Number.POSITIVE_INFINITY; return; }
  const now = dependencies.now();
  const elapsed = Math.max(0, now - lastTokenRefillAt);
  availableRequestTokens = Math.min(requestsPerSecond, availableRequestTokens + elapsed * requestsPerSecond / 1000);
  lastTokenRefillAt = now;
}

function scheduleDrainForRateLimit() {
  if (drainTimer || !Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) return;
  const waitMs = Math.max(1, Math.ceil((1 - availableRequestTokens) * 1000 / requestsPerSecond));
  drainTimer = setTimeout(() => { drainTimer = null; drain(); }, waitMs);
}

function takeNext(): QueueEntry | undefined {
  if (queues.HIGH.length && (highSinceLower < 3 || (!queues.NORMAL.length && !queues.BACKGROUND.length))) {
    highSinceLower += 1;
    return queues.HIGH.shift();
  }
  if (queues.BACKGROUND.length && (!queues.NORMAL.length || normalSinceBackground >= 3)) {
    normalSinceBackground = 0; highSinceLower = 0;
    return queues.BACKGROUND.shift();
  }
  if (queues.NORMAL.length) { normalSinceBackground += 1; highSinceLower = 0; return queues.NORMAL.shift(); }
  normalSinceBackground = 0; highSinceLower = 0;
  return queues.BACKGROUND.shift();
}

function drain() {
  while (activeRequests < maximumConcurrency) {
    const blockedUntil = activeBackoff();
    if (blockedUntil) {
      const next = takeNext();
      if (!next) return;
      counters.backoffPrevented += 1;
      next.reject(new DexScreenerProviderBackoffError(blockedUntil));
      continue;
    }
    if (recoveryRequired && recoveryProbeInFlight) return;
    refillRequestTokens();
    if (availableRequestTokens < 1) { scheduleDrainForRateLimit(); return; }
    const next = takeNext();
    if (!next) return;
    availableRequestTokens -= 1;
    const recoveryProbe = recoveryRequired;
    if (recoveryProbe) { recoveryProbeInFlight = true; log('RECOVERY_PROBE_STARTED', { priority: next.priority }); }
    activeRequests += 1;
    next.run(recoveryProbe);
  }
}

function schedule<T>(priority: DexScreenerPriority, task: (recoveryProbe: boolean) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queues[priority].push({ priority, reject, run: recoveryProbe => {
      void task(recoveryProbe).then(resolve, reject).finally(() => { activeRequests -= 1; drain(); });
    } });
    drain();
  });
}

export async function governedDexScreenerJson<T>(args: {
  url: string; caller: string; endpoint: string; priority?: DexScreenerPriority;
  cacheKey?: string; cacheTtlMs?: number; signal?: AbortSignal;
}): Promise<GovernedDexScreenerValue<T>> {
  const key = (args.cacheKey ?? args.url).toLowerCase();
  const now = dependencies.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    counters.cacheHits += 1;
    logActivity(args.caller, args.endpoint, args.priority ?? 'NORMAL');
    return { value: cached.value as T, fetchedAt: cached.fetchedAt, source: 'DEXSCREENER', cache: 'HIT' };
  }
  const existing = inflight.get(key);
  if (existing) {
    counters.inflightHits += 1;
    logActivity(args.caller, args.endpoint, args.priority ?? 'NORMAL');
    const result = await existing;
    return { ...result, value: result.value as T, cache: 'INFLIGHT' };
  }
  const blockedUntil = activeBackoff();
  if (blockedUntil) {
    counters.backoffPrevented += 1;
    logActivity(args.caller, args.endpoint, args.priority ?? 'NORMAL');
    if (now - lastBackoffActiveLogAt >= 15_000) {
      lastBackoffActiveLogAt = now;
      log('BACKOFF_ACTIVE', { caller: args.caller, endpoint: args.endpoint,
        backoffUntil: new Date(blockedUntil).toISOString() });
    }
    throw new DexScreenerProviderBackoffError(blockedUntil);
  }
  const request = schedule(args.priority ?? 'NORMAL', async (recoveryProbe): Promise<GovernedDexScreenerValue<T>> => {
    counters.requests += 1;
    logActivity(args.caller, args.endpoint, args.priority ?? 'NORMAL');
    try {
      const response = await dependencies.fetch(args.url, { headers: { Accept: 'application/json' }, signal: args.signal });
      const body = await response.text();
      if (response.status === 429) {
        enterBackoff(response, body, args.caller, args.endpoint);
        throw new DexScreenerProviderBackoffError(providerBackoffUntil);
      }
      if (!response.ok) throw new Error(`DexScreener request failed: ${response.status} ${body.slice(0, 500)}`);
      const value = JSON.parse(body) as T;
      const fetchedAt = new Date(dependencies.now()).toISOString();
      if ((args.cacheTtlMs ?? 0) > 0) cache.set(key, { value, fetchedAt, expiresAt: dependencies.now() + args.cacheTtlMs! });
      if (recoveryProbe) {
        recoveryRequired = false; recoveryProbeInFlight = false; consecutiveRateLimits = 0;
        log('RECOVERED', { caller: args.caller, endpoint: args.endpoint });
      }
      return { value, fetchedAt, source: 'DEXSCREENER', cache: 'MISS' };
    } catch (error) {
      if (recoveryProbe && !isDexScreenerProviderBackoffError(error)) {
        enterBackoff(new Response('', { status: 503 }), '', args.caller, args.endpoint);
      }
      throw error;
    }
  });
  inflight.set(key, request as Promise<GovernedDexScreenerValue<unknown>>);
  try { return await request; } finally { inflight.delete(key); }
}

export function getDexScreenerBackoffState(): { active: boolean; until: number | null } {
  const until = activeBackoff();
  return { active: until != null, until };
}

export function isDexScreenerProviderBackoffError(error: unknown): error is DexScreenerProviderBackoffError {
  return error instanceof DexScreenerProviderBackoffError;
}

export function getDexScreenerGovernorMetrics() { return { ...counters, activeRequests,
  queueDepth: queues.HIGH.length + queues.NORMAL.length + queues.BACKGROUND.length,
  recoveryRequired, recoveryProbeInFlight, requestsPerSecond }; }

export function resetDexScreenerGovernorForTests(overrides: Partial<GovernorDependencies> & { maxConcurrency?: number; rateLimitPerSecond?: number } = {}) {
  if (drainTimer) clearTimeout(drainTimer); drainTimer = null;
  cache.clear(); inflight.clear(); queues.HIGH.length = queues.NORMAL.length = queues.BACKGROUND.length = 0;
  activeRequests = 0; providerBackoffUntil = 0; consecutiveRateLimits = 0; recoveryRequired = false; recoveryProbeInFlight = false; normalSinceBackground = 0;
  highSinceLower = 0; lastBackoffActiveLogAt = 0; lastActivityLogAt = Number.NEGATIVE_INFINITY;
  Object.assign(counters, { requests: 0, cacheHits: 0, inflightHits: 0, backoffPrevented: 0, rateLimited: 0 });
  dependencies = { fetch: overrides.fetch ?? globalThis.fetch, now: overrides.now ?? Date.now, random: overrides.random ?? Math.random };
  maximumConcurrency = overrides.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  requestsPerSecond = overrides.rateLimitPerSecond ?? Number.POSITIVE_INFINITY;
  availableRequestTokens = requestsPerSecond; lastTokenRefillAt = dependencies.now();
}
