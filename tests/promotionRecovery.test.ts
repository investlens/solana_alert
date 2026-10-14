import {promotionDeliveryResult} from '../src/services/promotionDeliveryResult.js';
import {finishProtectedBoost,classifyBoostAttempt,boostPurchaseKey} from '../src/chains/robinhood/boostRecoveryState.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {deliverAlphaSemanticEvent} from '../src/services/alphaSemanticDeliveryService.js';
import {createFreshDexPaymentWatch} from '../src/chains/robinhood/freshDexPaymentWatch.js';
import {createDexPaidEventGate} from '../src/chains/robinhood/security/dexPaidAlertSafetyGate.js';
import {claimBoostRecipientRecovery,acquireBoostRecipientClaim} from '../src/services/boostDeliveryGuard.js';
const token='0x'+'a'.repeat(40);
const user=(id:string)=>({telegram_id:id,tier:'paid' as const,username:null,first_name:null,subscription_status:'active' as const,free_trial_used:0,free_trial_limit:5,paid_active_until:null,is_blocked:false});
function deliveryHarness(ambiguous=false){
 const states=new Map<string,string>(),sends=new Map<string,number>();let reject=true;
 const dependencies={getUsers:async()=>[user('one'),user('two')],strategyEnabled:async()=>true,reserve:async()=>true,complete:async()=>{},release:async()=>{},sentUnconfirmed:async()=>{},blocked:async()=>{},
  recipientClaim:async(_event:string,id:string)=>{
   if(states.get(id)==='DELIVERED')return {state:'DELIVERED' as const};if(states.get(id)==='PENDING')return {state:'UNCONFIRMED' as const};
   states.set(id,'PENDING');return {state:'CLAIMED' as const,finish:async()=>{states.set(id,'DELIVERED');},release:async()=>{states.delete(id);}};
  },send:async(id:string)=>{sends.set(id,(sends.get(id)??0)+1);if(id==='two'&&reject){reject=false;throw Error(ambiguous?'network timeout':'Telegram send failed: 400 rejected');}return 42;}};
 return {dependencies,sends,states};
}
const args={event:{id:9001,eventIdentity:'v2:BOOST:protected:30',type:'BOOST',assetId:token,chain:'robinhood'},message:'BOOST',protectBoostRecipients:true};
test('partial boost recovery reaches only the failed recipient across independent delivery invocations',async()=>{
 const h=deliveryHarness();const first=await deliverAlphaSemanticEvent(args,h.dependencies);assert.deepEqual(first,{delivered:1,failed:1,alreadyConfirmed:0});
 const retry=await deliverAlphaSemanticEvent(args,h.dependencies);assert.deepEqual(retry,{delivered:1,failed:0,alreadyConfirmed:1});assert.equal(h.sends.get('one'),1);assert.equal(h.sends.get('two'),2);
 const last=await deliverAlphaSemanticEvent(args,h.dependencies);assert.deepEqual(last,{delivered:0,failed:0,alreadyConfirmed:2});assert.equal(h.sends.get('one'),1);assert.equal(h.sends.get('two'),2);
});
test('ambiguous boost send remains protected rather than retried or reported complete',async()=>{
 const h=deliveryHarness(true);await deliverAlphaSemanticEvent({...args,event:{...args.event,id:9002,eventIdentity:'ambiguous'}},h.dependencies);
 const retry=await deliverAlphaSemanticEvent({...args,event:{...args.event,id:9002,eventIdentity:'ambiguous'}},h.dependencies);assert.equal(retry.failed,1);assert.equal(retry.alreadyConfirmed,1);assert.equal(h.sends.get('two'),1);
});
test('recovery claim requires an explicitly protected checkpoint and never replaces the historical global key',async()=>{
 let calls=0;const claim=async(key:string,ttl:number,owner:string)=>{calls++;assert.match(key,/^alphaos:boost-recipient-recovery:/);assert.equal(ttl,90000);assert.equal(owner,'owner');return 'CLAIMED' as const;};
 assert.equal(await claimBoostRecipientRecovery(token,30,'owner',false,claim),'UNAVAILABLE');assert.equal(calls,0);assert.equal(await claimBoostRecipientRecovery(token,30,'owner',true,claim),'CLAIMED');
});
test('only payments really observed fresh survive aging, restart and exact-payment matching',()=>{
 const now=2_000_000_000_000,w=createFreshDexPaymentWatch(2),payment=now-1000;
 assert.equal(w.observe(token,payment,now),true);assert.equal(w.has(token,payment,now+700000),true);assert.equal(w.has(token,payment+1,now+700000),false);
 const restart=createFreshDexPaymentWatch();restart.restore(w.snapshot(now+700000),now+700000);assert.equal(restart.has(token,payment,now+700000),true);
 assert.equal(restart.has(token,payment,now+1800001),false);assert.equal(w.observe('0x'+'b'.repeat(40),now-700000,now),false);
 restart.restore([{token,payment,observedAt:payment+700000}],now+700000);assert.equal(restart.has(token,payment,now+700000),false);
});
test('watched DEX payment still requires a current paid order and selling gate; old first-seen payments block',async()=>{
 let now=2_000_000_000_000;const payment=now-1000,w=createFreshDexPaymentWatch();w.observe(token,payment,now);now+=700000;
 let paid=true,selling=true,calls=0;const gate=createDexPaidEventGate({now:()=>now,observedFresh:(t,p,n)=>w.has(t,p,n),
  paid:async()=>({tokenAddress:token,dexPaid:paid,status:paid?'PAID':'UNKNOWN',orderTypes:[],orderStatuses:[],latestPaymentTimestamp:payment,warnings:[],scannedAt:now}),launch:async()=>null,
  custom:async()=>{calls++;return {allowed:selling,route:'CUSTOM_SECURITY_REQUIRED',liquidity:{allowed:selling,status:'UNLOCKED',reason:'Liquidity not locked'},reason:'Exit checked',cached:false};}});
 assert.equal((await gate(token)).allowed,true);assert.equal(calls,1);selling=false;assert.equal((await gate(token)).allowed,false);paid=false;assert.equal((await gate(token)).allowed,false);
 paid=true;selling=true;now+=1800000;assert.equal((await gate(token)).allowed,false);
});

test('older boost completion preserves a newer pending total and recipient recovery',()=>{
 const old={tokenAddress:token,amount:10,totalAmount:30,previousTotal:20,firstAt:1000,recipientClaims:true as const};
 const newer={...old,totalAmount:60,previousTotal:30};const totals=new Map([[token,60]]),pending=new Map([[boostPurchaseKey(token,30),old],[boostPurchaseKey(token,60),newer]]),retries=new Map([[boostPurchaseKey(token,60),{total:60,firstAt:1000,nextAt:61000,attempts:1}]]);
 finishProtectedBoost(totals,pending,retries,token,30,old);assert.equal(totals.get(token),60);assert.equal(pending.get(boostPurchaseKey(token,60)),newer);assert.equal(retries.get(boostPurchaseKey(token,60))?.total,60);
 finishProtectedBoost(totals,pending,retries,token,60,newer);assert.equal(pending.size,0);assert.equal(retries.size,0);
});

test('already confirmed recipients close a DEX retry without reporting a new Telegram acceptance',()=>{
 assert.deepEqual(promotionDeliveryResult({delivered:0,failed:0,alreadyConfirmed:8}),{complete:true,outcome:'ALREADY_CONFIRMED'});
 assert.equal(promotionDeliveryResult({delivered:0,failed:1,alreadyConfirmed:8}).complete,false);
 const now=2_000_000_000_000,w=createFreshDexPaymentWatch();w.observe(token,now,now);assert.equal(w.remove(token,now+1),false);assert.equal(w.remove(token,now),true);assert.equal(w.snapshot(now).length,0);
});

test('boost recipient claims retry with the same owner and bounded pauses during Redis failures',async()=>{
 const owners:string[]=[],waits:number[]=[];const claim=await acquireBoostRecipientClaim('boost-event','recipient',async(_script,_keys,args)=>{owners.push(args[0]);if(owners.length<3)throw Error('temporary Redis failure');return 'CLAIMED';},async(ms)=>{waits.push(ms);});
 assert.equal(claim.state,'CLAIMED');assert.equal(new Set(owners).size,1);assert.deepEqual(waits,[1000,1000]);
});

test('boost retries retain immutable classification and a newer purchase uses the observed pending total',()=>{
 const pendingRow={tokenAddress:token,amount:30,totalAmount:30,previousTotal:null,firstAt:1000};const pending=new Map([[boostPurchaseKey(token,30),pendingRow]]),totals=new Map([[token,20]]);
 const retry=classifyBoostAttempt(totals,pending,token,{totalAmount:30,amount:30});assert.equal(retry?.type,'BOOST_DETECTED');assert.equal(retry?.boostAdded,30);
 const next=classifyBoostAttempt(totals,pending,token,{totalAmount:40,amount:10});assert.equal(next?.type,'BOOST_INCREASED');assert.equal(next?.boostAdded,10);
 assert.equal(classifyBoostAttempt(new Map(),new Map(),token,{totalAmount:40,amount:10}),null,'unseen historical totals still do not become purchases');
});

test('DEX gate cannot authorize one payment using a different currently approved order',async()=>{
 const now=2_000_000_000_000,payment=now-1000;let checks=0;
 const gate=createDexPaidEventGate({now:()=>now,paid:async()=>({tokenAddress:token,dexPaid:true,status:'PAID',orderTypes:[],orderStatuses:[],latestPaymentTimestamp:payment,warnings:[],scannedAt:now}),launch:async()=>({exists:true,token,deployer:null,launchType:'PONS'}),custom:async()=>{checks++;throw Error('Custom gate should not run');}});
 assert.equal((await gate(token,payment)).allowed,true);const mismatch=await gate(token,payment-1000);assert.equal(mismatch.allowed,false);assert.deepEqual(mismatch.reasons,['PAYMENT_CHANGED']);assert.equal(checks,0);
 assert.equal((await gate(token,payment/1000)).allowed,true,'seconds and milliseconds identify the same payment');
});


test('two close DEX payments survive restore and exact completion independently',()=>{
 const now=2_000_000_000_000,w=createFreshDexPaymentWatch();
 w.observe(token,now-2000,now);w.observe(token,now-1000,now);
 assert.equal(w.snapshot(now).length,2);
 const restored=createFreshDexPaymentWatch();restored.restore(w.snapshot(now),now+12*60000);
 assert.equal(restored.has(token,now-2000,now+12*60000),true);
 assert.equal(restored.has(token,now-1000,now+12*60000),true);
 restored.remove(token,(now-2000)/1000);
 assert.equal(restored.has(token,now-1000,now+12*60000),true);
 assert.equal(restored.snapshot(now+12*60000).length,1);
});

test('older DEX payment stays valid while still present and fails once withdrawn',async()=>{
 const now=2_000_000_000_000,older=now-2000,newer=now-1000;let payments=[older,newer];
 const gate=createDexPaidEventGate({now:()=>now,paid:async()=>({tokenAddress:token,dexPaid:true,status:'PAID',orderTypes:[],orderStatuses:[],latestPaymentTimestamp:newer,paymentTimestamps:payments,warnings:[],scannedAt:now}),launch:async()=>({exists:true,token,deployer:null,launchType:'PONS'}),custom:async()=>{throw Error('unexpected');}});
 assert.equal((await gate(token,older)).allowed,true);payments=[newer];
 assert.deepEqual((await gate(token,older)).reasons,['PAYMENT_CHANGED']);
});

test('both pending boost purchases retain original increments after newer acknowledgement',()=>{
 const old={tokenAddress:token,amount:10,totalAmount:30,previousTotal:20,firstAt:1000};
 const newer={...old,amount:30,totalAmount:60,previousTotal:30};
 const pending=new Map([[boostPurchaseKey(token,30),old],[boostPurchaseKey(token,60),newer]]),totals=new Map([[token,20]]),retries=new Map();
 finishProtectedBoost(totals,pending,retries,token,60,newer);
 assert.equal(classifyBoostAttempt(totals,pending,token,{totalAmount:30,amount:10})?.boostAdded,10);
 assert.equal(pending.size,1);finishProtectedBoost(totals,pending,retries,token,30,old);
 assert.equal(totals.get(token),60);assert.equal(pending.size,0);
});


test('critical boost checkpoints distinguish missing state from read/write failure',async()=>{
 const {loadPendingBoosts,savePendingBoosts}=await import('../src/chains/robinhood/pendingBoostRecovery.js');
 const now=Date.now(),row={tokenAddress:token,amount:10,totalAmount:30,previousTotal:20,firstAt:now,recipientClaims:true as const};
 assert.deepEqual(await loadPendingBoosts(async()=>null,now),[]);
 await assert.rejects(loadPendingBoosts(async()=>{throw Error('Redis timeout');},now),/timeout/);
 await assert.rejects(savePendingBoosts([row],async()=>{throw Error('write unacknowledged');},now),/unacknowledged/);
 let saved:unknown;await savePendingBoosts([row],async(_key,value)=>{saved=value;},now);assert.deepEqual(saved,[row]);
});
