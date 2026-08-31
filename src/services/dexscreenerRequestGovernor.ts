export type DexScreenerPriority = 'HIGH' | 'NORMAL' | 'BACKGROUND';

export type GovernedDexScreenerValue<T> = {
  value: T;
  fetchedAt: string;
  source: 'DEXSCREENER';
  cache: 'MISS' | 'HIT' | 'INFLIGHT';
};

export class DexScreenerProviderBackoffError extends Error {
  readonly code = 'DEXSCREENER_BACKOFF';
  readonly classification = 'RATE_LIMITED';
  constructor(readonly backoffUntil: number) {
    super(`DexScreener provider backoff active until ${new Date(backoffUntil).toISOString()}`);
    this.name = 'DexScreenerProviderBackoffError';
  }
}

export class DexScreenerQueueCapacityError extends Error {
  readonly code = 'DEFERRED_QUEUE_CAPACITY';
  constructor(readonly queueWaitMs: number) {
    super(`DexScreener queue capacity unavailable after ${queueWaitMs}ms`);
    this.name = 'DexScreenerQueueCapacityError';
  }
}

export class DexScreenerHttpTimeoutError extends Error {
  readonly code = 'HTTP_TIMEOUT';
  constructor(readonly timeoutMs: number) {
    super(`DexScreener HTTP execution timed out after ${timeoutMs}ms`);
    this.name = 'DexScreenerHttpTimeoutError';
  }
}

export class DexScreenerProviderHttpError extends Error {
  readonly code = 'PROVIDER_HTTP_ERROR';
  constructor(readonly status: number, body: string) {
    super(`DexScreener request failed: ${status} ${body.slice(0, 500)}`);
    this.name = 'DexScreenerProviderHttpError';
  }
}

export class DexScreenerMalformedResponseError extends Error {
  readonly code = 'MALFORMED_RESPONSE';
  constructor(message = 'DexScreener returned malformed JSON') {
    super(message);
    this.name = 'DexScreenerMalformedResponseError';
  }
}

type QueueEntry = { priority: DexScreenerPriority; run: (recoveryProbe: boolean) => void; reject: (error: unknown) => void;
  requestId: number; caller: string; endpoint: string; enqueuedAt: number;
  queueTimer?: ReturnType<typeof setTimeout>; abortCleanup?: () => void };
type CacheEntry = { expiresAt: number; fetchedAt: string; value: unknown };
type GovernorDependencies = { fetch: typeof fetch; now: () => number; random: () => number };
type ActiveRequest = { requestId: number; caller: string; priority: DexScreenerPriority; endpoint: string;
  enqueuedAt: number; admittedAt: number; httpStartedAt: number };
type CompletionClassification = 'SUCCESS' | 'HTTP_TIMEOUT' | 'CALLER_ABORT' | 'RATE_LIMITED' |
  'PROVIDER_HTTP_ERROR' | 'MALFORMED_RESPONSE' | 'THROWN_EXCEPTION';

const DEFAULT_MAX_CONCURRENCY = 2;
export const DEXSCREENER_REQUESTS_PER_SECOND = 2;
export const DEXSCREENER_EXECUTION_TIMEOUT_MS = 10_000;
const FALLBACK_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const ACTIVITY_LOG_INTERVAL_MS = 15_000;
const queues: Record<DexScreenerPriority, QueueEntry[]> = { HIGH: [], NORMAL: [], BACKGROUND: [] };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<GovernedDexScreenerValue<unknown>>>();
const activeRequestDetails = new Map<number, ActiveRequest>();
const recentCompletions: Array<{ requestId: number; caller: string; endpoint: string;
  classification: CompletionClassification; durationMs: number }> = [];
let nextRequestId = 1;
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
type CallerMetrics = { caller: string; priority: DexScreenerPriority; enqueued: number; admitted: number;
  queueWaitMs: number; httpDurationMs: number; success: number; queueDeferred: number; httpTimeout: number;
  providerError: number; rateLimited: number; cacheHit: number; inflightDedup: number; noUsablePair: number; malformedResponse: number };
const callerMetrics = new Map<string, CallerMetrics>();

function metricsFor(caller: string, priority: DexScreenerPriority) {
  const key = `${caller}:${priority}`;
  let value = callerMetrics.get(key);
  if (!value) { value = { caller, priority, enqueued: 0, admitted: 0, queueWaitMs: 0, httpDurationMs: 0,
    success: 0, queueDeferred: 0, httpTimeout: 0, providerError: 0, rateLimited: 0,
    cacheHit: 0, inflightDedup: 0, noUsablePair: 0, malformedResponse: 0 }; callerMetrics.set(key, value); }
  return value;
}

function log(status: string, fields: Record<string, unknown> = {}) {
  console.log('dexscreener_governor', { event: 'dexscreener_governor', status, ...fields,
    queueDepth: queues.HIGH.length + queues.NORMAL.length + queues.BACKGROUND.length, activeRequests });
}

function logActivity(caller: string, endpoint: string, priority: DexScreenerPriority) {
  const now = dependencies.now();
  if (now - lastActivityLogAt < ACTIVITY_LOG_INTERVAL_MS) return;
  lastActivityLogAt = now;
  const active = [...activeRequestDetails.values()];
  const callerBreakdown = active.reduce<Record<string, number>>((result, request) => {
    result[request.caller] = (result[request.caller] ?? 0) + 1; return result;
  }, {});
  log('ACTIVITY_SUMMARY', { caller, endpoint, priority, ...counters,
    oldestActiveRequestAgeMs: active.length ? Math.max(...active.map(request => now - request.httpStartedAt)) : 0,
    activeCallerBreakdown: callerBreakdown,
    activeRequestsDetail: active.map(request => ({ requestId: request.requestId, caller: request.caller,
      priority: request.priority, endpoint: request.endpoint, enqueueAgeMs: now - request.enqueuedAt,
      executionAgeMs: now - request.httpStartedAt })), recentCompletions: recentCompletions.slice(-10),
    callers: [...callerMetrics.values()].map(value => ({ ...value,
      averageQueueWaitMs: value.admitted ? Math.round(value.queueWaitMs / value.admitted) : 0,
      averageHttpDurationMs: value.success + value.httpTimeout + value.providerError
        ? Math.round(value.httpDurationMs / (value.success + value.httpTimeout + value.providerError)) : 0 })) });
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

function prepareAdmission(entry: QueueEntry) {
  if (entry.queueTimer) clearTimeout(entry.queueTimer);
  entry.abortCleanup?.();
  const metrics = metricsFor(entry.caller, entry.priority);
  metrics.admitted += 1;
  metrics.queueWaitMs += Math.max(0, dependencies.now() - entry.enqueuedAt);
  const admittedAt = dependencies.now();
  activeRequestDetails.set(entry.requestId, { requestId: entry.requestId, caller: entry.caller,
    priority: entry.priority, endpoint: entry.endpoint, enqueuedAt: entry.enqueuedAt,
    admittedAt, httpStartedAt: admittedAt });
}

function completionClassification(error: unknown): CompletionClassification {
  if (error == null) return 'SUCCESS';
  if (error instanceof DexScreenerHttpTimeoutError) return 'HTTP_TIMEOUT';
  if (error instanceof DexScreenerProviderBackoffError) return 'RATE_LIMITED';
  if (error instanceof DexScreenerProviderHttpError) return 'PROVIDER_HTTP_ERROR';
  if (error instanceof DexScreenerMalformedResponseError) return 'MALFORMED_RESPONSE';
  if ((error as { name?: unknown })?.name === 'AbortError') return 'CALLER_ABORT';
  return 'THROWN_EXCEPTION';
}

function completeActiveRequest(entry: QueueEntry, error: unknown) {
  const active = activeRequestDetails.get(entry.requestId);
  activeRequestDetails.delete(entry.requestId);
  recentCompletions.push({ requestId: entry.requestId, caller: entry.caller, endpoint: entry.endpoint,
    classification: completionClassification(error), durationMs: active ? Math.max(0, dependencies.now() - active.httpStartedAt) : 0 });
  if (recentCompletions.length > 20) recentCompletions.shift();
}

function rejectQueuedEntry(entry: QueueEntry, error: unknown) {
  if (entry.queueTimer) clearTimeout(entry.queueTimer);
  entry.abortCleanup?.();
  entry.reject(error);
}

function drain() {
  while (activeRequests < maximumConcurrency) {
    const blockedUntil = activeBackoff();
    if (blockedUntil) {
      const next = takeNext();
      if (!next) return;
      counters.backoffPrevented += 1;
      rejectQueuedEntry(next, new DexScreenerProviderBackoffError(blockedUntil));
      continue;
    }
    if (recoveryRequired && recoveryProbeInFlight) return;
    refillRequestTokens();
    if (availableRequestTokens < 1) { scheduleDrainForRateLimit(); return; }
    const next = takeNext();
    if (!next) return;
    prepareAdmission(next);
    availableRequestTokens -= 1;
    const recoveryProbe = recoveryRequired;
    if (recoveryProbe) { recoveryProbeInFlight = true; log('RECOVERY_PROBE_STARTED', { priority: next.priority }); }
    activeRequests += 1;
    next.run(recoveryProbe);
  }
}

function schedule<T>(args: { priority: DexScreenerPriority; caller: string; endpoint: string;
  queueWaitTimeoutMs?: number; signal?: AbortSignal }, task: (recoveryProbe: boolean) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (args.signal?.aborted) { reject(args.signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
    const entry: QueueEntry = { requestId: nextRequestId++, priority: args.priority, caller: args.caller, endpoint: args.endpoint,
      enqueuedAt: dependencies.now(), reject, run: recoveryProbe => {
      void task(recoveryProbe).then(value => { completeActiveRequest(entry, null); resolve(value); }, error => {
        completeActiveRequest(entry, error); reject(error);
      }).finally(() => { activeRequests = Math.max(0, activeRequests - 1); drain(); });
    } };
    metricsFor(args.caller, args.priority).enqueued += 1;
    const removeAndReject = (error: unknown) => {
      const queue = queues[entry.priority]; const index = queue.indexOf(entry);
      if (index < 0) return;
      queue.splice(index, 1); if (entry.queueTimer) clearTimeout(entry.queueTimer); entry.abortCleanup?.(); reject(error);
    };
    if (args.queueWaitTimeoutMs != null) entry.queueTimer = setTimeout(() => {
      metricsFor(args.caller, args.priority).queueDeferred += 1;
      removeAndReject(new DexScreenerQueueCapacityError(args.queueWaitTimeoutMs!));
    }, args.queueWaitTimeoutMs);
    if (args.signal) {
      const onAbort = () => removeAndReject(args.signal!.reason ?? new DOMException('Aborted', 'AbortError'));
      args.signal.addEventListener('abort', onAbort, { once: true });
      entry.abortCleanup = () => args.signal!.removeEventListener('abort', onAbort);
    }
    queues[args.priority].push(entry);
    drain();
  });
}

export async function governedDexScreenerJson<T>(args: {
  url: string; caller: string; endpoint: string; priority?: DexScreenerPriority;
  cacheKey?: string; cacheTtlMs?: number; signal?: AbortSignal; queueWaitTimeoutMs?: number; httpTimeoutMs?: number;
}): Promise<GovernedDexScreenerValue<T>> {
  const priority = args.priority ?? 'NORMAL';
  const key = (args.cacheKey ?? args.url).toLowerCase();
  const now = dependencies.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    counters.cacheHits += 1;
    metricsFor(args.caller, priority).cacheHit += 1; logActivity(args.caller, args.endpoint, priority);
    return { value: cached.value as T, fetchedAt: cached.fetchedAt, source: 'DEXSCREENER', cache: 'HIT' };
  }
  const existing = inflight.get(key);
  if (existing) {
    counters.inflightHits += 1;
    metricsFor(args.caller, priority).inflightDedup += 1; logActivity(args.caller, args.endpoint, priority);
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
  const request = schedule({ priority, caller: args.caller, endpoint: args.endpoint,
    queueWaitTimeoutMs: args.queueWaitTimeoutMs, signal: args.signal }, async (recoveryProbe): Promise<GovernedDexScreenerValue<T>> => {
    counters.requests += 1;
    const metrics = metricsFor(args.caller, priority); const httpStartedAt = dependencies.now();
    logActivity(args.caller, args.endpoint, priority);
    const timeoutMs = args.httpTimeoutMs ?? DEXSCREENER_EXECUTION_TIMEOUT_MS;
    const executionController = new AbortController();
    const timeoutError = new DexScreenerHttpTimeoutError(timeoutMs);
    const executionTimer = setTimeout(() => executionController.abort(timeoutError), timeoutMs);
    const signal = args.signal ? AbortSignal.any([args.signal, executionController.signal]) : executionController.signal;
    let abortCleanup = () => {};
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        if (signal.aborted) onAbort();
        else { signal.addEventListener('abort', onAbort, { once: true });
          abortCleanup = () => signal.removeEventListener('abort', onAbort); }
      });
      const operation = (async (): Promise<GovernedDexScreenerValue<T>> => {
        const response = await dependencies.fetch(args.url, { headers: { Accept: 'application/json' }, signal });
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        const body = await response.text();
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        if (response.status === 429) {
          metrics.rateLimited += 1;
          enterBackoff(response, body, args.caller, args.endpoint);
          throw new DexScreenerProviderBackoffError(providerBackoffUntil);
        }
        if (!response.ok) { metrics.providerError += 1; throw new DexScreenerProviderHttpError(response.status, body); }
        let value: T;
        try { value = JSON.parse(body) as T; }
        catch { metrics.malformedResponse += 1; throw new DexScreenerMalformedResponseError(); }
        const fetchedAt = new Date(dependencies.now()).toISOString();
        if ((args.cacheTtlMs ?? 0) > 0) cache.set(key, { value, fetchedAt, expiresAt: dependencies.now() + args.cacheTtlMs! });
        if (recoveryProbe) {
          recoveryRequired = false; recoveryProbeInFlight = false; consecutiveRateLimits = 0;
          log('RECOVERED', { caller: args.caller, endpoint: args.endpoint });
        }
        metrics.success += 1;
        return { value, fetchedAt, source: 'DEXSCREENER', cache: 'MISS' };
      })();
      return await Promise.race([operation, aborted]);
    } catch (error) {
      let failure = error;
      if (executionController.signal.aborted && !args.signal?.aborted) {
        metrics.httpTimeout += 1;
        failure = timeoutError;
      }
      if (recoveryProbe && !isDexScreenerProviderBackoffError(failure)) {
        enterBackoff(new Response('', { status: 503 }), '', args.caller, args.endpoint);
      }
      throw failure;
    } finally {
      clearTimeout(executionTimer); abortCleanup();
      metrics.httpDurationMs += Math.max(0, dependencies.now() - httpStartedAt);
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
  recoveryRequired, recoveryProbeInFlight, requestsPerSecond, maxConcurrency: maximumConcurrency,
  executionTimeoutMs: DEXSCREENER_EXECUTION_TIMEOUT_MS,
  oldestActiveRequestAgeMs: activeRequestDetails.size
    ? Math.max(...[...activeRequestDetails.values()].map(request => dependencies.now() - request.httpStartedAt)) : 0,
  activeRequestDetails: [...activeRequestDetails.values()].map(request => ({ ...request })),
  recentCompletions: [...recentCompletions], callers: [...callerMetrics.values()].map(value => ({ ...value })) }; }

export function recordDexScreenerCallerOutcome(caller: string, priority: DexScreenerPriority,
  outcome: 'NO_USABLE_PAIR' | 'MALFORMED_RESPONSE') {
  const metrics = metricsFor(caller, priority);
  if (outcome === 'NO_USABLE_PAIR') metrics.noUsablePair += 1;
  else metrics.malformedResponse += 1;
}

export function resetDexScreenerGovernorForTests(overrides: Partial<GovernorDependencies> & { maxConcurrency?: number; rateLimitPerSecond?: number } = {}) {
  if (drainTimer) clearTimeout(drainTimer); drainTimer = null;
  cache.clear(); inflight.clear(); activeRequestDetails.clear(); recentCompletions.length = 0; callerMetrics.clear();
  queues.HIGH.length = queues.NORMAL.length = queues.BACKGROUND.length = 0; nextRequestId = 1;
  activeRequests = 0; providerBackoffUntil = 0; consecutiveRateLimits = 0; recoveryRequired = false; recoveryProbeInFlight = false; normalSinceBackground = 0;
  highSinceLower = 0; lastBackoffActiveLogAt = 0; lastActivityLogAt = Number.NEGATIVE_INFINITY;
  Object.assign(counters, { requests: 0, cacheHits: 0, inflightHits: 0, backoffPrevented: 0, rateLimited: 0 });
  dependencies = { fetch: overrides.fetch ?? globalThis.fetch, now: overrides.now ?? Date.now, random: overrides.random ?? Math.random };
  maximumConcurrency = overrides.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  requestsPerSecond = overrides.rateLimitPerSecond ?? Number.POSITIVE_INFINITY;
  availableRequestTokens = requestsPerSecond; lastTokenRefillAt = dependencies.now();
}
