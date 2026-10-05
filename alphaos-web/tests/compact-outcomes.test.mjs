import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTrackedOutcome } from '../lib/dashboard/compact-outcomes.ts';
const now = Date.parse('2026-10-05T19:00:00Z');
const event = {id:1,asset_id:'0xabc',chain:'robinhood',semantic_event_type:'DEX_PAID',price:2,alerted_at:'2026-10-05T17:00:00Z'};
const tracking = {chain:'robinhood',token:'0xabc',feed:'DEX_PAID',price_unit:'USD',baseline_price:2,started_at:'2026-10-05T17:00:01Z',samples:[{status:'MEASURED',price:3,at:'2026-10-05T17:15:01Z'}]};
const map = (e=event,t=tracking,identities=[]) => mapTrackedOutcome(e,[],false,[t],identities,now);
test('existing compact observation yields comparable prices and accepted delivery',()=>{
  const row=map(); assert.equal(row.alertPrice,2); assert.equal(row.currentPrice,3); assert.equal(row.peakPrice,3); assert.equal(row.roiNow,50); assert.equal(row.deliveryStatus,'Delivery recorded');
});
for (const [name, patch] of [['chain',{chain:'arc'}],['token',{token:'0xdef'}],['feed',{feed:'BOOST'}],['later alert',{started_at:'2026-10-05T18:00:00Z'}],['ETH ratio',{price_unit:'ETH_RESERVE_RATIO'}],['conflicting price',{baseline_price:4}]]) {
  test(`does not attach ${name}`,()=>assert.equal(map(event,{...tracking,...patch}).currentPrice,null));
}
test('receipt in recovery audit does not require a duplicate delivery table write',()=>{
  assert.equal(map({...event,raw_snapshot:{deliveryMode:'RECOVERY',acceptedRecipients:9}},{...tracking,feed:'BOOST'}).deliveryStatus,'Delivery recorded');
  assert.match(map({...event,raw_snapshot:{deliveryMode:'RECOVERY',acceptedRecipients:'9'}},{...tracking,feed:'BOOST'}).deliveryStatus,/unconfirmed/);
});
test('pending tracking is not presented as a zero return',()=>{const row=map(event,{...tracking,samples:[]});assert.equal(row.roiNow,null);assert.equal(row.trackingStatus,'Checkpoint pending');});
test('future and unavailable samples do not produce performance',()=>{for(const sample of [{status:'UNAVAILABLE',price:3,at:'2026-10-05T17:15:01Z'},{status:'MEASURED',price:3,at:'2026-10-06T00:00:00Z'}])assert.equal(map(event,{...tracking,samples:[sample]}).roiNow,null);});
test('identity lookup is chain scoped and never replaces stored identity',()=>{
  assert.equal(map(event,tracking,[{chain:'arc',token_address:'0xabc',symbol:'WRONG'}]).symbol,'0xabc…xabc');
  assert.equal(map(event,tracking,[{chain:'robinhood',token_address:'0xabc',symbol:'TEST',name:'Test'}]).symbol,'TEST');
  assert.equal(map({...event,symbol:'ORIGINAL'},tracking,[{chain:'robinhood',token_address:'0xabc',symbol:'TEST'}]).symbol,'ORIGINAL');
});
