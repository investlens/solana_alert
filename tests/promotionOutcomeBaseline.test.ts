import test from 'node:test';import assert from 'node:assert/strict';
import {capturePromotionOutcomeBaseline} from '../src/services/promotionOutcomeBaseline.js';
import {createPromotionOutcomeCapture} from '../src/services/promotionOutcomeCapture.js';
const token='0x'+'1'.repeat(40),pair='0x'+'2'.repeat(64),now=Date.now();
const stats={price:0.01,marketCap:10000,liquidity:20000,chartUrl:'https://dexscreener.com/robinhood/'+pair,source:'DEXScreener · PONS-mapped graduated pool',preBond:false};
const args={eventIdentity:'v2:DEX_PAID:test:1',token,feed:'DEX_PAID' as const,stats,expectedPair:pair,now};
test('capture freezes the final rendered quote and exact venue, independently of later enrichment',()=>{
 const rendered={...stats};const b=capturePromotionOutcomeBaseline({...args,stats:rendered});rendered.price=99;rendered.chartUrl='https://dexscreener.com/robinhood/'+token;
 assert.equal(b.price,0.01);assert.equal(b.pair_id,pair);assert.equal(b.reason,'VERIFIED_EXACT_PAIR');assert.equal(b.captured_at,new Date(now).toISOString());
 const later=capturePromotionOutcomeBaseline({...args,eventIdentity:'v2:DEX_PAID:test:2',stats:{...stats,price:0.02}});
 assert.equal(later.price,0.02);assert.notEqual(later.event_identity,b.event_identity);
});
test('prebond, unverified quotes and wrong venues produce explicit exclusion facts without fabricated prices',()=>{
 const cases:[any,string][]=[[{stats:null},'NO_RENDERED_STATS'],[{stats:{...stats,preBond:true}},'PRE_BOND_NO_COMPARABLE_DEX_BASELINE'],[{stats:{...stats,source:'PONS reported quote'}},'UNVERIFIED_MARKET_SOURCE'],[{stats:{...stats,chartUrl:'https://dexscreener.com/arc/'+pair}},'EXACT_PAIR_UNAVAILABLE'],[{expectedPair:token},'CHECKED_POOL_MISMATCH'],[{stats:{...stats,price:NaN}},'PRICE_UNAVAILABLE']];
 for(const [patch,reason]of cases){const b=capturePromotionOutcomeBaseline({...args,...patch});assert.equal(b.reason,reason);assert.equal(b.price,null);assert.equal(b.pair_id,null);assert.equal(b.price_unit,null);}
});
test('concurrent promotion captures serialize token admission and retain acknowledgement through ledger retries',async()=>{
 const b=capturePromotionOutcomeBaseline(args);let active=0,peak=0,registrations=0,saves=0,clock=now;const stored:any[]=[];
 const capture=createPromotionOutcomeCapture({now:()=>clock,register:async()=>{registrations++;active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return 'REGISTERED';},save:async job=>{saves++;if(saves===1)throw Error('offline');stored.push({...job});},report:()=>{}});
 await Promise.all([capture.record(b,new Date(now+1).toISOString()),capture.record({...b,event_identity:'second'},new Date(now+2).toISOString())]);
 assert.equal(peak,1);assert.equal(registrations,1);clock+=60001;
 await capture.record({...b,event_identity:'third'},new Date(now+3).toISOString());
 assert.equal(registrations,3,'a failed ledger write does not repeat admission');assert.equal(stored.length,3);assert.equal(stored[0].admission,'REGISTERED');
});
