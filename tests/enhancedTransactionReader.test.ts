import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnhancedTransactionReader } from '../src/core/enhancedTransactionReader.js';

test('429 cools down every wallet and repeated throttles increase cooldown', async () => {
  let clock = 1000; let calls = 0;
  const reader = createEnhancedTransactionReader(() => 'test', async () => { calls++; return new Response('', {status:429}); }, () => clock);
  assert.deepEqual(await reader('a'), []);
  await reader('b'); assert.equal(calls, 1);
  clock += 300_001; await reader('b'); assert.equal(calls, 2);
  clock += 300_001; await reader('c'); assert.equal(calls, 2);
  clock += 300_001; await reader('c'); assert.equal(calls, 3);
});

test('concurrent duplicate polls share a request and successful evidence expires', async () => {
  let calls = 0; let clock = 1000;
  const reader = createEnhancedTransactionReader(() => 'test', async () => { calls++; return new Response(JSON.stringify([{signature:'sig'}])); }, () => clock);
  const [a,b] = await Promise.all([reader('a'),reader('a')]);
  assert.deepEqual(a,b); assert.equal(calls,1);
  await reader('a'); assert.equal(calls,1);
  clock += 15_001; await reader('a'); assert.equal(calls,2);
});

test('malformed provider data is unknown and Retry-After is respected', async () => {
  let clock=1000; let calls=0;
  const reader = createEnhancedTransactionReader(()=>'test', async()=>{calls++;return calls===1 ? new Response('',{status:429,headers:{'retry-after':'900'}}) : new Response('{"error":"bad"}');},()=>clock);
  await reader('a'); clock+=600_000; await reader('b'); assert.equal(calls,1);
  clock+=300_001; assert.deepEqual(await reader('b'),[]); assert.equal(calls,2);
});

test('Pump market queue pressure is deferred work rather than a provider failure', async () => {
  const { pumpMarketReadFailure }=await import('../src/chains/solana/pumpfunMomentumWorker.js');
  const { DexScreenerQueueCapacityError, DexScreenerProviderBackoffError }=await import('../src/services/dexscreenerRequestGovernor.js');
  assert.equal(pumpMarketReadFailure(new DexScreenerQueueCapacityError(4000)),'MARKET_BUDGET_WAIT');
  assert.equal(pumpMarketReadFailure(new DexScreenerProviderBackoffError(Date.now()+1000)),'MARKET_BUDGET_WAIT');
  assert.equal(pumpMarketReadFailure(new Error('network unavailable')),'MARKET_PROVIDER_UNAVAILABLE');
});
