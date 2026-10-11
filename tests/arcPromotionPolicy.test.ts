import test from 'node:test';import assert from 'node:assert/strict';
import {arcDeliverySafety,ARC_PROMOTION_WARNING} from '../src/chains/arc/promotionPolicy.js';
import {readFileSync} from 'node:fs';
import {polishArcTelegramPresentation} from '../src/chains/arc/telegramPresentation.js';
test('ARC boost and DEX paid require exit evidence and block confirmed honeypots',async()=>{
 for(const feed of ['ARC_BOOST','ARC_DEX_PAID']){
  let calls=0;
  for(const reason of ['honeypot','cannot-sell flag']){
   const blocked=await arcDeliverySafety(feed,'token',async()=>{calls++;return {allowed:false,sellabilityBlocked:true,reason};});
   assert.equal(blocked.allowed,false);assert.equal(blocked.reason,reason);
  }
  const unknown=await arcDeliverySafety(feed,'token',async()=>{calls++;return {allowed:false,reason:'missing data'};},async()=>({allowed:false,reason:'Exit unverified',observedAt:Date.now()}));
  assert.equal(unknown.allowed,false);assert.match(unknown.reason,/missing data/);
  const unavailable=await arcDeliverySafety(feed,'token',async()=>{calls++;throw new Error('provider timeout');},async()=>({allowed:false,reason:'Exit unverified',observedAt:Date.now()}));
  assert.equal(unavailable.allowed,false);assert.match(unavailable.reason,/Provider check unavailable/);
  const verified=await arcDeliverySafety(feed,'token',async()=>{calls++;return {allowed:true,sellabilityVerified:true,reason:'flags clear',devHoldingPercent:10,top10Percent:30};},async()=>({allowed:true,reason:'Simulated exit · LP lock unverified',observedAt:Date.now()}));
  assert.equal(verified.allowed,true);assert.match(verified.reason,/LP lock unverified/);
  assert.equal(verified.devHoldingPercent,10);assert.equal(verified.top10Percent,30);assert.equal(calls,5);
 }
 const check=async()=>({allowed:false,reason:'market security gate'});
 assert.equal((await arcDeliverySafety('ARC_OPPORTUNITY','token',check)).allowed,false);
 assert.equal((await arcDeliverySafety('ARC_SUPPLY_BURN','token',check)).allowed,false);
 const source=readFileSync(new URL('../scripts/runArcLive.ts',import.meta.url),'utf8');
 assert.match(source,/arcDeliverySafety\('ARC_DEX_PAID',token,checkArcBoostSecurity\)/);
 assert.match(source,/text \+= .*sellSafety.reason/);
});
test('premium ARC boost formatter preserves unchecked warning and removes safety approval',()=>{
 const text=`🚀 <b>BOOST DETECTED · ARC</b>\n<b>ABC</b>\n🔥 Boost <b>10 total (+10)</b>\n<code>0x${'1'.repeat(40)}</code>\n⚠️ <b>${ARC_PROMOTION_WARNING}</b>`;
 const rendered=polishArcTelegramPresentation(text).text;
 assert.match(rendered,/verified exit evidence/);assert.doesNotMatch(rendered,/No honeypot|flag detected/);
});
test('every ARC positive feed requires an exit; unlocked and unknown LP produce risky alerts',async()=>{
 for(const feed of ['ARC_BOOST','ARC_DEX_PAID','ARC_OPPORTUNITY','ARC_SUPPLY_BURN']){
  for(const lpStatus of ['LOCKED','BURNED','UNLOCKED','UNKNOWN'] as const){
   const result=await arcDeliverySafety(feed,'token',async()=>({allowed:true,reason:'flags passed'}),async()=>({allowed:true,reason:'Same-wallet exit simulated',observedAt:Date.now(),lpStatus}));
   assert.equal(result.allowed,true);
   assert.equal(result.reason.includes('RISKY ALERT'),lpStatus==='UNLOCKED'||lpStatus==='UNKNOWN');
  }
  const result=await arcDeliverySafety(feed,'token',async()=>({allowed:true,reason:'flags passed'}),async()=>({allowed:false,reason:'Exit unverified',observedAt:Date.now()}));
  assert.equal(result.allowed,false);
 }
});
