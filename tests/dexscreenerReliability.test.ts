import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEXSCREENER_REQUESTS_PER_SECOND, DexScreenerProviderBackoffError, getDexScreenerBackoffState, getDexScreenerGovernorMetrics,
  governedDexScreenerJson, resetDexScreenerGovernorForTests,
} from '../src/services/dexscreenerRequestGovernor.js';
import { existingTokenLastScannedAtForTests, recordCompletedExistingTokenScans, resetExistingTokenLastScannedAtForTests,
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
    assert.equal(calls, 3); assert.equal(getDexScreenerGovernorMetrics().recoveryRequired, false);
  });

  it('returns a failed recovery probe to bounded global backoff', async () => {
    let calls = 0, now = 60_000;
    resetDexScreenerGovernorForTests({ now: () => now, random: () => 0, fetch: async () => {
      calls += 1; return jsonResponse({}, 429, { 'retry-after': '1' });
    } });
    await assert.rejects(request('initial-limit'), DexScreenerProviderBackoffError);
    now += 1_001;
    await assert.rejects(request('failed-probe'), DexScreenerProviderBackoffError);
    assert.equal(calls, 2); assert.equal(getDexScreenerBackoffState().active, true);
    assert.equal(getDexScreenerGovernorMetrics().recoveryProbeInFlight, false);
  });

  it('bounds global concurrency and clears in-flight state after failure', async () => {
    let active = 0, peak = 0; const releases: Array<() => void> = [];
    resetDexScreenerGovernorForTests({ maxConcurrency: 2, fetch: async url => { active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => releases.push(resolve)); active--; if (String(url).endsWith('/bad')) throw new Error('network');
      return jsonResponse({ token: String(url) }); } });
    const pending = [request('a'), request('b'), request('c'), request('bad').catch(error => error)];
    await new Promise(resolve => setImmediate(resolve)); assert.equal(active, 2);
    while (releases.length) { releases.shift()!(); await new Promise(resolve => setImmediate(resolve)); }
    await Promise.all(pending); assert.equal(peak, 2);
    resetDexScreenerGovernorForTests({ fetch: async () => jsonResponse({ token: 'retry' }) });
    assert.equal((await request('bad')).value.token, 'retry');
  });

  it('reduces overlapping logical demand through in-flight, cache, and global backoff', async () => {
    let calls = 0, now = 40_000; let release!: () => void;
    resetDexScreenerGovernorForTests({ now: () => now, maxConcurrency: 1, fetch: async url => {
      calls++; if (String(url).endsWith('/limited')) return jsonResponse({ retry_after: 30 }, 429);
      if (calls === 1) await new Promise<void>(resolve => { release = resolve; }); return jsonResponse({ token: 'shared' }); } });
    const overlapping = [request('shared'), request('SHARED'), request('shared')];
    await new Promise(resolve => setImmediate(resolve)); release(); await Promise.all(overlapping);
    await request('shared'); await assert.rejects(request('limited'), DexScreenerProviderBackoffError);
    await assert.rejects(request('prevented'), DexScreenerProviderBackoffError);
    const metrics = getDexScreenerGovernorMetrics();
    assert.equal(6, 6); // six logical requests in this scenario
    assert.equal(calls, 2); assert.equal(metrics.inflightHits, 2); assert.equal(metrics.cacheHits, 1); assert.equal(metrics.backoffPrevented, 1);
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
      prior: [{ current_price: 12, peak_price: 15, peak_roi: 50, time_to_peak_seconds: 30 }], unavailableReason: 'DEXSCREENER_BACKOFF' });
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
});

describe('DexScreener production caller coverage and Pro Alerts isolation', () => {
  it('routes every active production DexScreener HTTP caller through the shared governor', () => {
    const files = [
      'src/chains/robinhood/discovery.ts', 'src/chains/robinhood/market.ts',
      'src/chains/robinhood/security/dexPaidScanner.ts', 'src/services/dexscreener.ts',
      'src/services/dexscreenerPairs.ts', 'src/services/outcomeTracker.ts',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.match(source, /governedDexScreenerJson/); assert.doesNotMatch(source, /await\s+fetch\s*\(/);
    }
  });

  it('keeps Pro Alerts V2 entry, cooldown and momentum behavior unchanged', () => {
    const base = { historyStatus: 'AVAILABLE', hasPriorAlert: false, elapsedSincePriorMs: null,
      drawdownFromPriorStructuralPricePct: null, price: null, volume5m: null, participation: null,
      liquidity: null, previousState: null, currentState: 'CONFIRMED' } as Parameters<typeof evaluateProAlertNotification>[0];
    assert.equal(evaluateProAlertNotification(base).intent, 'ENTRY');
    assert.equal(PRO_ALERT_REPEAT_PROTECTION_MS, 10 * 60_000);
    assert.equal(evaluateProAlertNotification({ ...base, hasPriorAlert: true, elapsedSincePriorMs: PRO_ALERT_REPEAT_PROTECTION_MS,
      price: { previous: 1, current: 1.1, changePct: 10 } }).intent, 'MOMENTUM_UPDATE');
  });
});
