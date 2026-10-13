import test from 'node:test';
import assert from 'node:assert/strict';
import {promotionAlertPolicy,reportedPromotionSells,PROMOTION_POLICY_VERSION} from '../src/security/promotionAlertPolicy.js';
test('locked policy is identical for BOOST and DEX on Robin and ARC',()=>{
 assert.equal(PROMOTION_POLICY_VERSION,'2026-10-13.1');
 for(const chain of ['robinhood','arc'])for(const feed of ['BOOST','DEX_PAID']){
  for(const lpStatus of ['LOCKED','BURNED','UNLOCKED','UNKNOWN'] as const){
   const args={sells:11,exitVerified:true,lpStatus};
   const result=promotionAlertPolicy(args);assert.equal(result.allowed,true,chain+feed);
   if(lpStatus==='UNLOCKED')assert.match(result.reason,/LIQUIDITY NOT LOCKED/);
   if(lpStatus==='UNKNOWN')assert.match(result.reason,/LP LOCK NOT VERIFIED/);
   assert.equal(promotionAlertPolicy({...args,sells:0}).allowed,false);
   assert.equal(promotionAlertPolicy({...args,sells:null}).watch,true);
   assert.equal(promotionAlertPolicy({...args,exitVerified:false}).allowed,false);
   assert.equal(promotionAlertPolicy({...args,hardBlocked:true}).allowed,false);
  }
 }
});
test('verified PONS bypasses custom sell and LP requirements',()=>{
 const result=promotionAlertPolicy({verifiedPons:true,sells:0,exitVerified:false,lpStatus:'UNKNOWN'});
 assert.equal(result.allowed,true);assert.equal(result.watch,false);
});
test('sell counts are taken from reported windows without treating missing counts as zero',()=>{
 assert.equal(reportedPromotionSells({txns:{m5:{sells:0},h24:{sells:11}}}),11);
 assert.equal(reportedPromotionSells({txns:{m5:{sells:0}}}),0);
 for(const pair of [{}, {txns:{m5:{sells:'11'}}}, {txns:{m5:{sells:-1}}}])assert.equal(reportedPromotionSells(pair),null);
});
