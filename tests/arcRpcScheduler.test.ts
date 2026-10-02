import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcRpcScheduler, isArcProviderFailure, isArcRateLimit } from '../src/chains/arc/rpcScheduler.js';
import { canRetryArcEnrichment } from '../src/chains/arc/enrichment.js';
test('concurrent RPC work is serialized, paced and queue admission bounded', async () => {
  let time = 0, active = 0, max = 0; const starts: number[] = [];
  const schedule = createArcRpcScheduler({ capacity: 3, now: () => time, sleep: async ms => { time += ms; } });
  const work = async () => { active++; max = Math.max(max, active); starts.push(time); await Promise.resolve(); active--; return 1; };
  const tasks = [schedule(work), schedule(work), schedule(work)];
  await assert.rejects(schedule(work), /capacity/); await Promise.all(tasks);
  assert.deepEqual(starts, [0, 200, 400]); assert.equal(max, 1);
});
test('expired queue work never reaches the provider and a rejection does not deadlock it', async () => {
  let time = 0, calls = 0;
  const schedule = createArcRpcScheduler({ maxWaitMs: 100, now: () => time, sleep: async ms => { time += ms; } });
  const first = schedule(async () => { time = 150; throw new Error('network'); });
  const second = schedule(async () => { calls++; });
  await assert.rejects(first, /network/); await assert.rejects(second, /expired/); assert.equal(calls, 0);
  time = 500; await schedule(async () => { calls++; }); assert.equal(calls, 1);
});
test('token execution failures do not penalize providers; rate limits do', () => {
  assert.equal(isArcProviderFailure(new Error('Contract function reverted: empty return data')), false);
  assert.equal(isArcRateLimit(new Error('Request exceeds defined limit')), true);
  assert.equal(isArcProviderFailure(new Error('Request exceeds defined limit')), true);
  assert.equal(isArcProviderFailure(new Error('fetch failed')), true);
});
test('only temporary metadata gaps can retry; actual empty contracts and unsafe hooks remain rejected', () => {
  const base = { hooks: '0x0000000000000000000000000000000000000000', safetyReasons: ['CONTRACT_CODE_UNAVAILABLE'] } as any;
  assert.equal(canRetryArcEnrichment(base), true);
  assert.equal(canRetryArcEnrichment({ ...base, safetyReasons: ['NO_CONTRACT_CODE'] }), false);
  assert.equal(canRetryArcEnrichment({ ...base, safetyReasons: ['ZERO_TOTAL_SUPPLY'] }), false);
  assert.equal(canRetryArcEnrichment({ ...base, hooks: '0x1111111111111111111111111111111111111111' }), false);
});
