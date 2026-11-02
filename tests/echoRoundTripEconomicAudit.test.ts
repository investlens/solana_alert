import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEchoRoundTripEconomics,ECHO_ECONOMIC_AUDIT_ALLOWS_TRADING} from
 '../src/echo/roundTripEconomicAudit.js';
const base={
 buyLamports:'100000000',sellExpectedLamports:'125000000',
 pumpBuyBps:125,pumpSellBps:125,
 builderBuyBps:50,builderSellBps:50,
 buyPriorityLamports:'90000',sellPriorityLamports:'100000',
 buySignatureLamports:'5000',sellSignatureLamports:'5000',
 rentOrAtaLamports:'2039280',
 buySlippageBps:300,sellSlippageBps:300,
 buyAndSellQuoteIndependent:true
};
test('round trip includes venue fees, slippage, network and ATA rent for both sides',()=>{
 const a=reviewEchoRoundTripEconomics(base);
 assert.equal(a.ok,true);
 assert.equal(a.mode,'READ_ONLY');assert.equal(a.signingApproved,false);
 assert.equal(a.venueFeesLamports,'3937500');
 assert.equal(a.networkAndPriorityLamports,'200000');
 assert.equal(a.rentLamports,'2039280');
 assert.ok(Number(a.profitLamports)>0);
 assert.equal(ECHO_ECONOMIC_AUDIT_ALLOWS_TRADING,false);
});
test('missing independent SELL quote, fee schedule, rent or live signature fee fails closed',()=>{
 for(const x of [
  {...base,buyAndSellQuoteIndependent:false},
  {...base,pumpBuyBps:null},
  {...base,builderSellBps:null},
  {...base,rentOrAtaLamports:null},
  {...base,buySignatureLamports:null},
  {...base,sellExpectedLamports:'invalid'},
  {...base,buyLamports:'100000001'},
  {...base,buySlippageBps:301},
  {...base,buyPriorityLamports:'500001'}
 ]){
  const r=reviewEchoRoundTripEconomics(x);
  assert.equal(r.ok,false);
  assert.equal(r.signingApproved,false);
 }
});
test('negative after cost even for a superficially positive SELL quote is not profitable',()=>{
 const q=reviewEchoRoundTripEconomics({...base,sellExpectedLamports:'102000000'});
 assert.equal(q.ok,true);
 assert.equal(q.reason,'NO_POSITIVE_EXPECTED_RETURN');
 assert.ok(Number(q.profitLamports)<0);
});
test('no mock fee or missing cost can become signing permission',()=>{
 const x=reviewEchoRoundTripEconomics({...base,pumpSellBps:0,builderBuyBps:0});
 assert.equal(x.ok,true);
 assert.equal(x.signingApproved,false);
});
