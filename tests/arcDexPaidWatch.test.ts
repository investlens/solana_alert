import test from 'node:test';import assert from 'node:assert/strict';
import {createArcDexPaidWatch,freshArcPayment}from '../src/chains/arc/dexPaidWatch.js';
const token='0x'+'1'.repeat(40);
test('fresh payment parser excludes cancelled, stale, future and malformed orders',()=>{
 const now=2000000000000;
 assert.equal(freshArcPayment([{paymentTimestamp:now/1000,status:'approved'}],now),now);
 for(const p of [[{paymentTimestamp:(now-700000)/1000}],[{paymentTimestamp:(now+60000)/1000}],[{paymentTimestamp:now,status:'cancelled'}],{}])assert.equal(freshArcPayment(p,now),null);
});
test('bounded ARC payment watcher checks security, deduplicates and performs no SQL work',async()=>{
 let now=2000000000000,sends=0,safe=false,reads=0;const claims=new Set<string>();
 const watch=createArcDexPaidWatch({now:()=>now,read:async(url)=>{reads++;return url.includes('/orders/')?[{paymentTimestamp:2000000000,status:'approved'}]:[];},security:async()=>({allowed:safe,reason:'sellability missing'}),claim:async(key)=>{if(claims.has(key))return'EXISTS';claims.add(key);return'CLAIMED';},send:async()=>{sends++;}});
 watch.seed(token);await watch.tick();assert.equal(sends,0);
 safe=true;now+=30000;await watch.tick();assert.equal(sends,1);
 now+=30000;await watch.tick();assert.equal(sends,1);
 for(let i=0;i<40;i++)watch.seed('0x'+(i+10).toString(16).padStart(40,'0'));
 assert.equal(watch.size(),24);const before=reads;await watch.tick();assert.equal(reads,before);
});
