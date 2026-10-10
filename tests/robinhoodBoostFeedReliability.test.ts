import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRobinhoodBoosts } from '../src/chains/robinhood/discovery.js';
import { resetDexScreenerGovernorForTests, DexScreenerProviderBackoffError, getDexScreenerGovernorMetrics } from '../src/services/dexscreenerRequestGovernor.js';
test('boost feed propagates rate limits instead of reporting a successful empty baseline',async()=>{
 resetDexScreenerGovernorForTests({fetch:async()=>new Response('{}',{status:429}),random:()=>0});
 await assert.rejects(fetchRobinhoodBoosts(),DexScreenerProviderBackoffError);
 assert.equal(getDexScreenerGovernorMetrics().callers.find(c=>c.caller==='robinhood_discovery')?.priority,'HIGH');
 resetDexScreenerGovernorForTests();
});
test('boost feed distinguishes malformed responses from a legitimate empty feed',async()=>{
 resetDexScreenerGovernorForTests({fetch:async()=>new Response('{}',{status:200})});
 await assert.rejects(fetchRobinhoodBoosts(),/Malformed DexScreener boost feed/);
 resetDexScreenerGovernorForTests({fetch:async()=>new Response('[]',{status:200})});
 assert.deepEqual(await fetchRobinhoodBoosts(),[]);
 resetDexScreenerGovernorForTests();
});

test('boost polling reuses brief cache but refreshes before the old 90-second blind spot',async()=>{
 let now=Date.parse('2026-10-10T00:00:00Z');let calls=0;
 resetDexScreenerGovernorForTests({now:()=>now,fetch:async()=>{calls++;return new Response('[]',{status:200});}});
 await fetchRobinhoodBoosts();await fetchRobinhoodBoosts();assert.equal(calls,1);
 now+=16000;await fetchRobinhoodBoosts();assert.equal(calls,2);
 resetDexScreenerGovernorForTests();
});
