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

import {arcBoostSafetyFromEvidence,arcDexPaidSafety}from '../src/chains/arc/boostSafety.js';
test('ARC DEX withholds unavailable security but cannot override confirmed exit restrictions',()=>{
 for(const evidence of [null,{}, {is_honeypot:'0'}]){
  const boost=arcBoostSafetyFromEvidence(evidence);assert.equal(boost.allowed,false);
  const paid=arcDexPaidSafety(boost);assert.equal(paid.allowed,false);assert.equal(paid.sellabilityVerified,false);assert.match(paid.reason,/unverified/);
 }
 for(const evidence of [{is_honeypot:'1'},{cannot_sell_all:'1'}])assert.equal(arcDexPaidSafety(arcBoostSafetyFromEvidence(evidence)).allowed,false);
 assert.equal(arcDexPaidSafety(arcBoostSafetyFromEvidence({is_honeypot:'0',cannot_sell_all:'0'})).sellabilityVerified,true);
});

test('rotated promotion discovery finds ARC ads without increasing check budget or duplicating delivery',async()=>{
 let now=2000000000000; const urls:string[]=[],sent:string[]=[];const claims=new Set<string>();
 const watch=createArcDexPaidWatch({now:()=>now,read:async url=>{urls.push(url);return url.includes('/orders/')?[{paymentTimestamp:now,status:'approved'}]:url.includes('/ads/')?[{chainId:'arc',tokenAddress:token}]:[];},security:async()=>({allowed:true,reason:'unknown warning'}),claim:async key=>{if(claims.has(key))return 'EXISTS';claims.add(key);return 'CLAIMED';},send:async t=>{sent.push(t);}});
 for(let i=0;i<3;i++){await watch.tick();now+=60000;}
 assert.deepEqual(sent,[token]);assert.equal(urls.filter(u=>!u.includes('/orders/')).length,3);
 assert.ok(urls.some(u=>u.includes('recent-updates')));assert.ok(urls.some(u=>u.includes('/ads/')));
 for(let i=0;i<30;i++)watch.seed('0x'+(i+10).toString(16).padStart(40,'0'));
 assert.equal(watch.size(),24);
});
