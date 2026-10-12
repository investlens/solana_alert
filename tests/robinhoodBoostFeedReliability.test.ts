import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRobinhoodBoosts } from '../src/chains/robinhood/discovery.js';
import {observeBoostCanonicalEvent} from '../src/chains/robinhood/boostCanonicalEvent.js';
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
 await fetchRobinhoodBoosts();await fetchRobinhoodBoosts();assert.equal(calls,2);
 now+=16000;await fetchRobinhoodBoosts();assert.equal(calls,3);
 resetDexScreenerGovernorForTests();
});
test('TOP coverage merges by contract and total while preserving latest provenance on ties',async()=>{
 const token='0x'+'a'.repeat(40),older='0x'+'b'.repeat(40);
 resetDexScreenerGovernorForTests({fetch:async(url)=>Response.json(String(url).includes('/top/')?[{chainId:'robinhood',tokenAddress:token,amount:10,totalAmount:20},{chainId:'robinhood',tokenAddress:older,amount:5,totalAmount:50}]:[{chainId:'robinhood',tokenAddress:token,amount:10,totalAmount:20}])});
 const rows=await fetchRobinhoodBoosts();assert.equal(rows.length,2);assert.equal(rows.find(r=>r.tokenAddress===token)?.source,'LATEST');assert.equal(rows.find(r=>r.tokenAddress===older)?.source,'TOP');
 resetDexScreenerGovernorForTests();
});
test('historical TOP appearance seeds a baseline; genuine later increment remains alertable',()=>{
 const totals=new Map<string,number>();
 assert.equal(observeBoostCanonicalEvent(totals,'token',100,100,'TOP'),null);
 assert.equal(observeBoostCanonicalEvent(totals,'token',100,100,'TOP'),null);
 const event=observeBoostCanonicalEvent(totals,'token',110,10,'TOP');
 assert.equal(event?.type,'BOOST_INCREASED');assert.equal(event?.boostAdded,10);
});
