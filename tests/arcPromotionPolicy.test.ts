import test from 'node:test';import assert from 'node:assert/strict';
import {arcDeliverySafety,ARC_PROMOTION_WARNING} from '../src/chains/arc/promotionPolicy.js';
import {readFileSync} from 'node:fs';
import {polishArcTelegramPresentation} from '../src/chains/arc/telegramPresentation.js';
test('ARC promotion events skip provider checks and explicitly disclose unchecked risk',async()=>{
 let calls=0;const check=async()=>{calls++;return {allowed:false,reason:'cannot sell'};};
 for(const feed of ['ARC_BOOST','ARC_DEX_PAID']){
  const result=await arcDeliverySafety(feed,'token',check);
  assert.equal(result.allowed,true);assert.equal(result.sellabilityVerified,false);assert.match(result.reason,/NOT CHECKED/);
 }
 assert.equal(calls,0);assert.match(ARC_PROMOTION_WARNING,/Verify selling and liquidity/);
 assert.equal((await arcDeliverySafety('ARC_OPPORTUNITY','token',check)).allowed,false);
 assert.equal((await arcDeliverySafety('ARC_SUPPLY_BURN','token',check)).allowed,false);assert.equal(calls,2);
 const source=readFileSync(new URL('../scripts/runArcLive.ts',import.meta.url),'utf8');
 const boost=source.slice(source.indexOf('async function deliverArcBoost('),source.indexOf('async function pollArcBoosts('));
 assert.doesNotMatch(boost,/await checkArcBoostSecurity/);assert.match(source,/text \+= .*ARC_PROMOTION_WARNING/);
});
test('premium ARC boost formatter preserves unchecked warning and removes safety approval',()=>{
 const text=`🚀 <b>BOOST DETECTED · ARC</b>\n<b>ABC</b>\n🔥 Boost <b>10 total (+10)</b>\n<code>0x${'1'.repeat(40)}</code>\n⚠️ <b>${ARC_PROMOTION_WARNING}</b>`;
 const rendered=polishArcTelegramPresentation(text).text;
 assert.match(rendered,/NOT CHECKED/);assert.doesNotMatch(rendered,/No honeypot|flag detected/);
});
