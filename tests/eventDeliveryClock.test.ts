import test from 'node:test';import assert from 'node:assert/strict';
import {createEventDeliveryClock} from '../src/services/eventDeliveryClock.js';
import {remainingDeliveryDelay} from '../src/services/recipientDeliveryTiming.js';
const start=Date.parse('2026-10-18T10:00:00Z');
test('a restart reuses the original event clock instead of adding another tier delay',async()=>{
 let now=start,calls=0;const shared=new Map<string,string>();
 const atomic=async(_s:string,keys:string[],args:string[])=>{calls++;if(!shared.has(keys[0]))shared.set(keys[0],args[0]);return shared.get(keys[0]);};
 const first=createEventDeliveryClock({atomic,now:()=>now});assert.equal(await first('event-A',now),start);
 now+=20_000;
 const restarted=createEventDeliveryClock({atomic,now:()=>now});const anchor=await restarted('event-A',now);
 assert.equal(anchor,start);
 const pro={telegram_id:'42',tier:'paid',subscription_status:'active',paid_active_until:new Date(start+3600_000).toISOString()};
 assert.equal(remainingDeliveryDelay(pro,anchor,now),0);
 assert.equal(remainingDeliveryDelay({telegram_id:'43'},anchor,now),10_000);
 now+=40_000;assert.equal(await restarted('event-A',now),start);
 assert.equal(remainingDeliveryDelay({telegram_id:'43'},anchor,now),0);assert.equal(calls,2);
});
test('concurrent attempts coalesce, and separate boost increments retain separate clocks',async()=>{
 let now=start,calls=0;const atomic=async(_s:string,_k:string[],a:string[])=>{calls++;await Promise.resolve();return a[0];};
 const resolve=createEventDeliveryClock({atomic,now:()=>now});
 assert.deepEqual(await Promise.all([resolve('boost:50',now),resolve('boost:50',now)]),[start,start]);assert.equal(calls,1);
 now+=1000;assert.equal(await resolve('boost:100',now),now);assert.equal(calls,2);
});
test('outage keeps the local original clock and retries persistence only after cooldown',async()=>{
 let now=start,calls=0;const states:string[]=[];
 const resolve=createEventDeliveryClock({atomic:async(_s,_k,a)=>{calls++;if(calls===1)throw Error('outage');return a[0];},now:()=>now,report:s=>states.push(s)});
 assert.equal(await resolve('event',now),start);
 now+=20_000;assert.equal(await resolve('event',now),start);assert.equal(calls,1);
 now+=41_000;assert.equal(await resolve('event',now),start);assert.equal(calls,2);
 assert.deepEqual(states,['LOCAL_FALLBACK','SHARED']);
});
test('future, corrupt and expired shared timestamps cannot release users early',async()=>{
 for(const raw of [String(start+1),'not-a-clock',String(start-86_400_000),'0',1 as any]){
  const states:string[]=[];const resolve=createEventDeliveryClock({atomic:async()=>raw,now:()=>start,report:s=>states.push(s)});
  assert.equal(await resolve('event',start),start);assert.deepEqual(states,['LOCAL_FALLBACK']);
 }
});
test('an unavailable shared operation has a deadline and cannot stall all delivery',async()=>{
 let now=start;const resolve=createEventDeliveryClock({atomic:async()=>new Promise(()=>{}),now:()=>now,deadlineMs:5});
 assert.equal(await resolve('event',now),start);
 now+=1000;assert.equal(await resolve('event',now),start);
});
