import test from 'node:test';import assert from 'node:assert/strict';
import {forEachDeliveryRecipient,deliveryAcceptanceEvidence} from '../src/services/recipientDeliveryTiming.js';
test('blocked free lane does not hold admin or Pro, and each lane has at most four workers',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let active=0,max=0;const seen:string[]=[];
 const users=[...Array.from({length:12},(_,i)=>({telegram_id:`free${i}`,tier:'free'})),{telegram_id:'admin',tier:'admin'},{telegram_id:'pro',tier:'paid',subscription_status:'active',paid_active_until:new Date(Date.now()+60000).toISOString()}];
 const work=forEachDeliveryRecipient(users,async user=>{if(user.tier==='free'){active++;max=Math.max(max,active);await gate;active--;}else seen.push(user.telegram_id);});
 await new Promise(r=>setImmediate(r));assert.deepEqual(seen.sort(),['admin','pro']);assert.equal(max,4);release();await work;
});
test('accepted timing reports lateness separately from early-release protection',()=>{
 const e=deliveryAcceptanceEvidence({tier:'free'},1000,'test',false,35000);
 assert.equal(e.releaseDelayMs,30000);assert.equal(e.releaseLatenessMs,4000);assert.equal(e.releaseDeadlineMet,true);
});
