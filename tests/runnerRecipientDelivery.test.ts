import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverRunnerRecipient} from '../src/services/runnerRecipientDelivery.js';
function claims(){
 const state=new Map<string,string>();
 const claim=async(event:string,recipient:string)=>{
  const key=event+':'+recipient;
  if(state.has(key))return {state:state.get(key)==='done'?'DELIVERED' as const:'UNCONFIRMED' as const};
  state.set(key,'pending');return {state:'CLAIMED' as const,finish:async()=>{state.set(key,'done');},release:async()=>{state.delete(key);}};
 };return {state,claim};
}
test('runner retries a rejected recipient without duplicating accepted recipients or lower milestones',async()=>{
 const {claim}=claims();let accepted=0,attempts=0;
 const good=()=>deliverRunnerRecipient('series','good',[2,5,10],async()=>{accepted++;return 1;},claim);
 await good();
 await assert.rejects(deliverRunnerRecipient('series','retry',[2,5,10],async()=>{attempts++;throw Error('Telegram delivery rejected: 400 Bad Request');},claim));
 await good();
 assert.equal(await deliverRunnerRecipient('series','retry',[2,5,10],async()=>{attempts++;return 2;},claim),true);
 assert.equal(await deliverRunnerRecipient('series','good',[2,5],async()=>{accepted++;return 3;},claim),false);
 assert.equal(accepted,1);assert.equal(attempts,2);
});
test('ambiguous runner sends remain claimed and are never retried',async()=>{
 const {claim}=claims();let sends=0;
 const send=async()=>{sends++;throw Error('network timeout');};
 await assert.rejects(deliverRunnerRecipient('series','user',[2,5],send,claim));
 assert.equal(await deliverRunnerRecipient('series','user',[2,5],send,claim),false);
 assert.equal(sends,1);
});
