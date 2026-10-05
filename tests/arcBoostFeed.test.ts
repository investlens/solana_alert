import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchArcBoostFeed, consistentArcVolume5m } from '../src/chains/arc/boostFeed.js';
import { resetDexScreenerGovernorForTests } from '../src/services/dexscreenerRequestGovernor.js';

test('ARC Boost honors provider backoff and reuses successful feed reads', async () => {
  let calls = 0;
  resetDexScreenerGovernorForTests({ fetch: async () => {
    calls++; return new Response('{}', {status:429,headers:{'retry-after':'60'}});
  }});
  await assert.rejects(fetchArcBoostFeed());
  await assert.rejects(fetchArcBoostFeed(), /backoff/);
  assert.equal(calls, 1);
  resetDexScreenerGovernorForTests({fetch:async()=>{
    calls++; return Response.json([{chainId:'arc',tokenAddress:'0x'+'1'.repeat(40),amount:10,totalAmount:30}]);
  }});
  const results = await Promise.all([fetchArcBoostFeed(),fetchArcBoostFeed()]);
  assert.equal(calls,2); assert.equal(results[0][0].totalAmount,30);
  await fetchArcBoostFeed(); assert.equal(calls,2);
  resetDexScreenerGovernorForTests();
});
test('malformed feeds fail rather than establish empty baseline', async()=>{
  resetDexScreenerGovernorForTests({fetch:async()=>Response.json({error:'unavailable'})});
  await assert.rejects(fetchArcBoostFeed(), /expected array/);
  resetDexScreenerGovernorForTests();
});
test('contradictory volume windows are not displayed as verified stats',()=>{
  assert.equal(consistentArcVolume5m(31650,4850),null);
  assert.equal(consistentArcVolume5m(0,4850),0);
  assert.equal(consistentArcVolume5m(null,4850),null);
});
