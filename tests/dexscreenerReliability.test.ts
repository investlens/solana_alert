import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEXSCREENER_EXECUTION_TIMEOUT_MS, DEXSCREENER_REQUESTS_PER_SECOND, DexScreenerHttpTimeoutError, DexScreenerMalformedResponseError,
  DexScreenerProviderBackoffError, DexScreenerProviderHttpError, DexScreenerQueueCapacityError,
  getDexScreenerBackoffState, getDexScreenerGovernorMetrics,
  governedDexScreenerJson, resetDexScreenerGovernorForTests,
} from '../src/services/dexscreenerRequestGovernor.js';
import { EXISTING_TOKEN_SCANNER_QUEUE_WAIT_MS, EXISTING_TOKEN_SCANNER_SUSTAINABLE_QUOTA,
  existingTokenLastScannedAtForTests, recordCompletedExistingTokenScans, resetExistingTokenLastScannedAtForTests,
  runExistingTokenProviderBatch } from '../src/chains/robinhood/existingTokenOpportunityScanner.js';
import { buildAlphaOutcomeCheckpoint } from '../src/services/alphaAlertOutcomeCheckpoints.js';
import { getRobinhoodMarketSnapshot } from '../src/chains/robinhood/market.js';
import { evaluateProAlertNotification, PRO_ALERT_REPEAT_PROTECTION_MS } from '../src/services/proAlertNotificationGovernor.js';

const jsonResponse = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const request = (token: string, extra: Partial<Parameters<typeof governedDexScreenerJson>[0]> = {}) =>
  governedDexScreenerJson<{ token: string }>({ url: `https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`,
    cacheKey: `robinhood:${token}`, cacheTtlMs: 15_000, caller: 'test', endpoint: 'TOKEN_PAIRS_ROBINHOOD', ...extra });

describe('shared DexScreener request governor', () => {
  it('passes successful requests through and preserves provenance and fetched time', async () => {
    let calls = 0; const now = Date.parse('2026-08-29T12:00:00Z');
    resetDexScreenerGovernorForTests({ now: () => now, fetch: async () => { calls++; return jsonResponse({ token: 'a' }); } });
    const result = await request('a');
    assert.equal(calls, 1); assert.equal(result.source, 'DEXSCREENER');
    assert.equal(result.fetchedAt, '2026-08-29T12:00:00.000Z'); assert.equal(result.cache, 'MISS');
  });

  it('deduplicates simultaneous normalized token requests and caches within TTL', async () => {
    let calls = 0; let release!: () => void;
    resetDexScreenerGovernorForTests({ fetch: async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return jsonResponse({ token: 'abc' }); } });
    const first = request('0xAbC'); const second = request('0xaBc');
    await new Promise(resolve => setImmediate(resolve)); release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1); assert.equal(b.cache, 'INFLIGHT'); assert.equal(a.fetchedAt, b.fetchedAt);
    const cached = await request('0xABC'); assert.equal(calls, 1); assert.equal(cached.cache, 'HIT');
  });

  it('normalizes Robinhood address casing and preserves cached snapshot age and provenance', async () => {
    let calls = 0; const now = Date.parse('2026-08-29T12:01:00Z');
    resetDexScreenerGovernorForTests({ now: () => now, fetch: async () => { calls++; return jsonResponse([{
      chainId: 'robinhood', baseToken: { address: '0xAbC', symbol: 'ABC' }, priceUsd: '1', liquidity: { usd: 10_000 },
    }]); } });
    const first = await getRobinhoodMarketSnapshot('0xAbC');
    const second = await getRobinhoodMarketSnapshot('0xaBc');
    assert.equal(calls, 1); assert.equal(first?.fetchedAt, '2026-08-29T12:01:00.000Z');
    assert.equal(second?.fetchedAt, first?.fetchedAt); assert.equal(second?.source, 'DEXSCREENER');
    assert.equal(second?.timestamp, first?.timestamp);
  });

  it('expires cache and permits a new outbound request', async () => {
    let calls = 0, now = 1_000;
    resetDexScreenerGovernorForTests({ now: () => now, fetch: async () => jsonResponse({ token: String(++calls) }) });
    await request('a'); now += 15_001; const result = await request('a');
    assert.equal(calls, 2); assert.equal(result.value.token, '2');
  });

  it('uses Retry-After header for global backoff across tokens and endpoints', async () => {
    let calls = 0, now = 10_000;
    resetDexScreenerGovernorForTests({ now: () => now, fetch: async () => { calls++; return jsonResponse({}, 429, { 'retry-after': '40' }); } });
    await assert.rejects(request('a'), DexScreenerProviderBackoffError);
    assert.equal(getDexScreenerBackoffState().until, now + 40_000);
    await assert.rejects(request('b'), DexScreenerProviderBackoffError);
    await assert.rejects(governedDexScreenerJson({ url: 'https://api.dexscreener.com/token-boosts/latest/v1', caller: 'boost', endpoint: 'BOOSTS' }), DexScreenerProviderBackoffError);
    assert.equal(calls, 1);
  });

  it('uses body retry_after fallback and resumes after expiry', async () => {
    let calls = 0, now = 20_000;
    resetDexScreenerGovernorForTests({ now: () => now, fetch: async () => ++calls === 1 ? jsonResponse({ retry_after: 30 }, 429) : jsonResponse({ token: 'ok' }) });
    await assert.rejects(request('a'), DexScreenerProviderBackoffError);
    assert.equal(getDexScreenerBackoffState().until, now + 30_000);
    now += 30_001; const result = await request('b');
    assert.equal(result.value.token, 'ok'); assert.equal(calls, 2); assert.equal(getDexScreenerBackoffState().active, false);
  });

  it('uses bounded fallback backoff when provider guidance is absent', async () => {
    let now = 30_000;
    resetDexScreenerGovernorForTests({ now: () => now, random: () => 0, fetch: async () => jsonResponse({}, 429) });
    await assert.rejects(request('a'), DexScreenerProviderBackoffError);
    assert.equal(getDexScreenerBackoffState().until, now + 30_000);
  });

  it('keeps fallback jitter inside the five-minute maximum', async () => {
    let now = 30_000;
    resetDexScreenerGovernorForTests({ now: () => now, random: () => 0.999999, fetch: async () => jsonResponse({}, 429) });
    for (let attempt = 0; attempt < 5; attempt++) {
      await assert.rejects(request(`limited-${attempt}`), DexScreenerProviderBackoffError);
      const until = getDexScreenerBackoffState().until!;
      assert.ok(until - now <= 5 * 60_000);
      now = until + 1;
    }
  });

  it('enforces the process-wide request-rate budget', async () => {
    const started: number[] = [];
    resetDexScreenerGovernorForTests({ rateLimitPerSecond: DEXSCREENER_REQUESTS_PER_SECOND,
      fetch: async () => { started.push(Date.now()); return jsonResponse({ token: 'ok' }); } });
    await Promise.all(['rate-a', 'rate-b', 'rate-c', 'rate-d'].map(token => request(token)));
    assert.equal(started.length, 4);
    assert.ok(started[2] - started[0] >= 400, `third request started after ${started[2] - started[0]}ms`);
    assert.ok(started[3] - started[0] >= 850, `fourth request started after ${started[3] - started[0]}ms`);
  });

  it('runs HIGH priority work before queued scanner backlog', async () => {
    const order: string[] = []; let release!: () => void;
    resetDexScreenerGovernorForTests({ maxConcurrency: 1, fetch: async url => {
      const token = String(url).split('/').pop()!; order.push(token);
      if (token === 'blocker') await new Promise<void>(resolve => { release = resolve; });
      return jsonResponse({ token });
    } });
    const blocker = request('blocker', { priority: 'BACKGROUND' });
    await new Promise(resolve => setImmediate(resolve));
    const background = request('background', { priority: 'BACKGROUND' });
    const high = request('high', { priority: 'HIGH' });
    release(); await Promise.all([blocker, background, high]);
    assert.deepEqual(order, ['blocker', 'high', 'background']);
  });

  it('does not consume the HTTP execution timeout while waiting in the queue', async () => {
    let release!: () => void;
    resetDexScreenerGovernorForTests({ maxConcurrency: 1, fetch: async url => {
      if (String(url).endsWith('/blocker')) await new Promise<void>(resolve => { release = resolve; });
      else await new Promise(resolve => setTimeout(resolve, 10));
      return jsonResponse({ token: 'ok' });
    } });
    const blocker = request('blocker'); await new Promise(resolve => setImmediate(resolve));
    const queued = request('queued', { queueWaitTimeoutMs: 200, httpTimeoutMs: 30 });
    await new Promise(resolve => setTimeout(resolve, 60)); release();
    assert.equal((await queued).value.token, 'ok'); await blocker;
  });

  it('returns typed queue-capacity deferral without starting HTTP', async () => {
    let release!: () => void; let calls = 0;
    resetDexScreenerGovernorForTests({ maxConcurrency: 1, fetch: async url => { calls++;
      if (String(url).endsWith('/blocker')) await new Promise<void>(resolve => { release = resolve; });
      return jsonResponse({ token: 'ok' }); } });
    const blocker = request('blocker'); await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(request('deferred', { queueWaitTimeoutMs: 20, httpTimeoutMs: 2_500 }), DexScreenerQueueCapacityError);
    assert.equal(calls, 1); release(); await blocker;
  });

  it('starts a full HTTP timeout only after admission and preserves external cancellation', async () => {
    resetDexScreenerGovernorForTests({ fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
    }) });
    await assert.rejects(request('http-timeout', { httpTimeoutMs: 20 }), DexScreenerHttpTimeoutError);
    const external = new AbortController(); const pending = request('external-cancel', { signal: external.signal, httpTimeoutMs: 2_500 });
    setTimeout(() => external.abort(new Error('caller cancelled')), 10);
    await assert.rejects(pending, /caller cancelled/);
  });

  it('settles two non-cooperative hung executions, releases both slots and drains queued work', async () => {
    let calls = 0;
    resetDexScreenerGovernorForTests({ maxConcurrency: 2, rateLimitPerSecond: Number.POSITIVE_INFINITY,
      fetch: async () => { calls += 1; if (calls <= 2) return new Promise<Response>(() => {});
        return jsonResponse({ token: 'recovered' }); } });
    const first = request('hung-a', { httpTimeoutMs: 25 });
    const second = request('hung-b', { httpTimeoutMs: 25 });
    const queued = request('queued-after-hang', { httpTimeoutMs: 100 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(getDexScreenerGovernorMetrics().activeRequests, 2);
    assert.equal(getDexScreenerGovernorMetrics().activeRequestDetails.length, 2);
    const [a, b, resumed] = await Promise.all([first.catch(error => error), second.catch(error => error), queued]);
    assert.ok(a instanceof DexScreenerHttpTimeoutError); assert.ok(b instanceof DexScreenerHttpTimeoutError);
    assert.equal(resumed.value.token, 'recovered');
    await new Promise(resolve => setImmediate(resolve));
    const settled = getDexScreenerGovernorMetrics();
    assert.equal(settled.activeRequests, 0); assert.equal(settled.queueDepth, 0);
    assert.equal(settled.activeRequestDetails.length, 0);
    assert.equal(settled.recentCompletions.filter(row => row.classification === 'HTTP_TIMEOUT').length, 2);
    assert.equal((await request('hung-a', { httpTimeoutMs: 100 })).value.token, 'recovered');
  });

  it('applies a mandatory conservative default execution timeout to every governed request', () => {
    assert.equal(DEXSCREENER_EXECUTION_TIMEOUT_MS, 10_000);
    resetDexScreenerGovernorForTests();
    assert.equal(getDexScreenerGovernorMetrics().executionTimeoutMs, 10_000);
  });

  it('keeps provider HTTP failures distinct from malformed responses and no-pair results', async () => {
    resetDexScreenerGovernorForTests({ fetch: async () => jsonResponse({ problem: true }, 503) });
    await assert.rejects(request('provider-error'), DexScreenerProviderHttpError);
    assert.equal(getDexScreenerGovernorMetrics().activeRequests, 0);
    resetDexScreenerGovernorForTests({ fetch: async () => jsonResponse({ pairs: [] }) });
    await assert.rejects(getRobinhoodMarketSnapshot('0xmalformed'), DexScreenerMalformedResponseError);
    assert.equal(getDexScreenerGovernorMetrics().activeRequests, 0);
    resetDexScreenerGovernorForTests({ fetch: async () => jsonResponse([]) });
    assert.equal(await getRobinhoodMarketSnapshot('0xno-pair'), null);
  });

  it('reports sampled per-caller queue, HTTP, cache, dedup and outcome metrics', async () => {
    resetDexScreenerGovernorForTests({ fetch: async () => jsonResponse({ token: 'ok' }) });
    await request('metrics'); await request('metrics');
    const metrics = getDexScreenerGovernorMetrics().callers.find(row => row.caller === 'test');
    assert.equal(metrics?.enqueued, 1); assert.equal(metrics?.admitted, 1); assert.equal(metrics?.success, 1);
    assert.equal(metrics?.cacheHit, 1); assert.ok((metrics?.httpDurationMs ?? -1) >= 0);
  });

  it('allows exactly one recovery probe and resumes queued work only after probe success', async () => {
    let calls = 0, now = 50_000; let releaseProbe!: () => void;
    resetDexScreenerGovernorForTests({ now: () => now, maxConcurrency: 2, fetch: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({}, 429, { 'retry-after': '1' });
      if (calls === 2) await new Promise<void>(resolve => { releaseProbe = resolve; });
      return jsonResponse({ token: 'ok' });
    } });
    await assert.rejects(request('initial-limit'), DexScreenerProviderBackoffError);
    now += 1_001;
    const probe = request('probe'); const queued = request('queued');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2); assert.equal(getDexScreenerGovernorMetrics().recoveryProbeInFlight, true);
    releaseProbe(); await Promise.all([probe, queued]);
    assert.equal(calls, 3); assert.equal(getDexScreenerBackoffState().active, false);
  });

  it('reopens backoff when the recovery probe is rate limited again', async () => {
    let calls = 0, now = 70_000;
    resetDexScreenerGovernorForTests({ now: () => now, random: () => 0, fetch: async () => { calls++;
      if (calls <= 2) return jsonResponse({}, 429, { 'retry-after': '1' }); return jsonResponse({ token: 'ok' }); } });
    await assert.rejects(request('first-limit'), DexScreenerProviderBackoffError); now += 1_001;
    await assert.rejects(request('probe-limit'), DexScreenerProviderBackoffError);
    assert.equal(calls, 2); assert.ok((getDexScreenerBackoffState().until ?? 0) > now);
  });

  it('keeps rolling completion history bounded under sustained use', async () => {
    resetDexScreenerGovernorForTests({ rateLimitPerSecond: Number.POSITIVE_INFINITY, fetch: async () => jsonResponse({ token: 'ok' }) });
    for (let i = 0; i < 230; i++) await request(`history-${i}`, { cacheTtlMs: 0 });
    assert.ok(getDexScreenerGovernorMetrics().recentCompletions.length <= 200);
  });
});

describe('existing-token scanner provider short-circuit', () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({ token: `0x${index}`, tier: 'HOT' as const, lastSeenAt: '2026-08-29T00:00:00Z' }));

  it('makes no token attempts when provider backoff is active and leaves every token retryable', async () => {
    let attempts = 0;
    const result = await runExistingTokenProviderBatch(entries, async () => { attempts++; return true; }, { backoffActive: () => true });
    assert.equal(attempts, 0); assert.equal(result.completed.length, 0); assert.equal(result.skipped, 25); assert.equal(result.providerBackoff, true);
  });

  it('stops after the request that enters backoff and resumes remaining work after recovery', async () => {
    let attempts = 0, active = false;
    const first = await runExistingTokenProviderBatch(entries, async entry => { attempts++;
      if (attempts === 3) { active = true; throw new DexScreenerProviderBackoffError(Date.now() + 30_000); }
      return entry.token; }, { concurrency: 1, backoffActive: () => active });
    assert.equal(attempts, 3); assert.equal(first.completed.length, 2); assert.equal(first.skipped, 23);
    active = false; const retryable = entries.filter(entry => !first.completed.some(row => row.entry.token === entry.token));
    const second = await runExistingTokenProviderBatch(retryable, async entry => entry.token, { concurrency: 1, backoffActive: () => false });
    assert.equal(second.completed.length, 23); assert.equal(second.providerBackoff, false);
  });

  it('keeps unavailable outcome ROI null and preserves prior verified peak', () => {
    const row = buildAlphaOutcomeCheckpoint({ event: { id: 1, asset_id: '0x1', chain: 'robinhood', price: 10, alerted_at: '2026-08-29T00:00:00Z' },
      checkpointSeconds: 60, currentPrice: null, source: null, provenance: null,
      prior: [{ checkpoint_seconds: 30, current_price: 12, peak_price: 15, peak_roi: 50, time_to_peak_seconds: 30 }], unavailableReason: 'DEXSCREENER_BACKOFF' });
    assert.equal(row.status, 'UNAVAILABLE'); assert.equal(row.current_roi, null); assert.equal(row.peak_price, 15);
    assert.equal(row.completeness.reason, 'DEXSCREENER_BACKOFF');
  });

  it('does not advance scanner timestamps for unavailable or deferred tokens', async () => {
    resetExistingTokenLastScannedAtForTests(); let attempts = 0, active = false;
    const result = await runExistingTokenProviderBatch(entries, async entry => {
      attempts += 1;
      if (attempts === 3) { active = true; throw new DexScreenerProviderBackoffError(Date.now() + 30_000); }
      return entry.token;
    }, { concurrency: 1, backoffActive: () => active });
    recordCompletedExistingTokenScans(result.completed.map(row => row.entry), 123_456);
    assert.equal(existingTokenLastScannedAtForTests(entries[0].token), 123_456);
    assert.equal(existingTokenLastScannedAtForTests(entries[1].token), 123_456);
    for (const entry of entries.slice(2)) assert.equal(existingTokenLastScannedAtForTests(entry.token), null);
  });

  it('keeps the scanner sustainable quota aligned with the shared 2 rps budget', () => {
    assert.equal(DEXSCREENER_REQUESTS_PER_SECOND, 2); assert.equal(EXISTING_TOKEN_SCANNER_SUSTAINABLE_QUOTA, 6);
    assert.equal(EXISTING_TOKEN_SCANNER_QUEUE_WAIT_MS, 75);
  });
});

describe('pro alert notification governor', () => {
  it('allows first alert, suppresses exact repeats, permits material changes and expires protection', () => {
    const base = { chain: 'robinhood', token: '0xABC', eventType: 'BOOST', price: 1, liquidityUsd: 10_000, marketCap: 20_000 };
    const first = evaluateProAlertNotification(base, 1_000); const repeat = evaluateProAlertNotification(base, 2_000);
    assert.equal(first.send, true); assert.equal(repeat.send, false); assert.equal(repeat.reason, 'REPEAT_PROTECTION');
    const material = evaluateProAlertNotification({ ...base, marketCap: 30_000 }, 3_000); assert.equal(material.send, true);
    const expired = evaluateProAlertNotification(base, 3_000 + PRO_ALERT_REPEAT_PROTECTION_MS + 1); assert.equal(expired.send, true);
  });

  it('uses a bounded in-memory repeat cache', () => {
    for (let i = 0; i < 5_100; i++) evaluateProAlertNotification({ chain: 'robinhood', token: `0x${i}`, eventType: 'BOOST', price: 1 }, i);
    const source = readFileSync(new URL('../src/services/proAlertNotificationGovernor.ts', import.meta.url), 'utf8');
    assert.match(source, /repeatCache\.size > 5_000/);
  });
});
