import test from 'node:test';import assert from 'node:assert/strict';
import {arcDeliverySafety,ARC_PROMOTION_WARNING} from '../src/chains/arc/promotionPolicy.js';
import {readFileSync} from 'node:fs';
import {polishArcTelegramPresentation} from '../src/chains/arc/telegramPresentation.js';
test('ARC boost and DEX paid block confirmed honeypots but allow unknown evidence with warnings',async()=>{
 for(const feed of ['ARC_BOOST','ARC_DEX_PAID']){
  let calls=0;
  for(const reason of ['honeypot','cannot-sell flag']){
   const blocked=await arcDeliverySafety(feed,'token',async()=>{calls++;return {allowed:false,sellabilityBlocked:true,reason};});
   assert.equal(blocked.allowed,false);assert.equal(blocked.reason,reason);
  }
  const unknown=await arcDeliverySafety(feed,'token',async()=>{calls++;return {allowed:false,reason:'missing data'};});
  assert.equal(unknown.allowed,true);assert.match(unknown.reason,/unverified/);
  const unavailable=await arcDeliverySafety(feed,'token',async()=>{calls++;throw new Error('provider timeout');});
  assert.equal(unavailable.allowed,true);assert.match(unavailable.reason,/unverified/);
  const verified=await arcDeliverySafety(feed,'token',async()=>{calls++;return {allowed:true,sellabilityVerified:true,reason:'flags clear',devHoldingPercent:10,top10Percent:30};});
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
 assert.match(rendered,/NOT CHECKED/);assert.doesNotMatch(rendered,/No honeypot|flag detected/);
});
