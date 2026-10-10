import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberRuntimeSubscriber,forgetRuntimeSubscriber,mergeRuntimeSubscribers,persistStartedSubscriber} from '../src/services/runtimeSubscriberRegistry.js';
import {createCreatorBalanceObserver} from '../src/services/creatorBalanceObservation.js';
import {withOwnershipDisclosure} from '../src/ui/ownershipDisclosure.js';
import {buildPromotionEventCard} from '../src/ui/promotionEventCard.js';

test('start joins a stale roster, preserves paid membership, and clears explicit rejection only on interaction',()=>{
  const id='enrollment-test';
  rememberRuntimeSubscriber({telegramId:id});
  const row={telegram_id:id,is_blocked:true,tier:'paid',paid_active_until:'2099-01-01'};
  assert.equal(mergeRuntimeSubscribers([row])[0].tier,'paid');
  assert.equal(mergeRuntimeSubscribers([row])[0].is_blocked,false);
  assert.equal(mergeRuntimeSubscribers([]).some(row=>row.telegram_id===id),true);
  forgetRuntimeSubscriber(id);
  assert.equal(mergeRuntimeSubscribers([{...row,is_blocked:false}]).some(row=>row.telegram_id===id),false);
  rememberRuntimeSubscriber({telegramId:id});
  assert.equal(mergeRuntimeSubscribers([]).some(row=>row.telegram_id===id),true);
  forgetRuntimeSubscriber(id);
});
test('registration retries transient failures without an endless write loop',async()=>{
  let attempts=0;const waits:number[]=[];
  await persistStartedSubscriber('user',async()=>{if(++attempts<3)throw new Error('timeout');},async ms=>{waits.push(ms);});
  assert.equal(attempts,3);assert.deepEqual(waits,[1000,5000]);
  attempts=0;await assert.rejects(persistStartedSubscriber('user',async()=>{attempts++;throw new Error('offline');},async()=>{}));
  assert.equal(attempts,3);
});
test('creator changes use fresh same-wallet observations, not transfers classified as sales',()=>{
  const observe=createCreatorBalanceObserver();
  const evidence={creator:'alice',devPercent:10,devObservedAt:1000,top10Percent:null,top10Coverage:'UNAVAILABLE' as const};
  observe('token',evidence,1000);
  const next=observe('token',{...evidence,devPercent:4,devObservedAt:2000},2000);
  const text=withOwnershipDisclosure('alert',next);
  assert.match(text,/-6.00 pp/);assert.match(text,/not proof of selling/);
  assert.equal(observe('token',{...evidence,creator:'bob',devObservedAt:2000},2000).devInitialPercent,10);
  assert.equal(observe('token',evidence,200000).devInitialPercent,undefined);
  assert.equal(observe('token',{...evidence,devObservedAt:500},1000).devInitialPercent,undefined);
});
test('a delayed card retains its captured market snapshot and creator observation',()=>{
  const stats={name:'Test',symbol:'TEST',price:0.01,marketCap:10000,preBond:true,source:'PONS',checkedAt:'04:00:00'};
  const card=buildPromotionEventCard({kind:'SOCIAL_MAFIA',token:'0x'+'1'.repeat(40),launchType:'PONS',stats,
    text:'SOCIAL MAFIA\nDev holding <b>4%</b>\nDev observed 04:00:00 UTC\nCreator balance change <b>-6.00 pp</b> · not proof of selling',securityNote:null,buttons:[]});
  assert.match(card.text,/MC.*10/);assert.match(card.text,/04:00:00 UTC/);assert.match(card.text,/-6.00 pp/);
  assert.equal(card.buttons[0][0].text,'🚀 PONS');
  assert.equal((card.text.match(/Creator balance change/g)??[]).length,1);
});
