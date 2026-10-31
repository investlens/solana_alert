import test from 'node:test';
import assert from 'node:assert/strict';
import {screenEchoFastFollower,ECHO_FAST_FOLLOWER_SIGNING_ENABLED}
 from '../src/echo/fastFollowerPriceGate.js';
const start=1762000000000;
const candidate={
 callerBuySignature:'3'.repeat(64),callerVerified:true,
 callerMint:'2'.repeat(44),quoteMint:'2'.repeat(44),
 callerBoughtAtMs:start,detectionAtMs:start+200,nowMs:start+600,
 quoteObservedAtMs:start+500,callerSpentLamports:'100000000',
 callerTokensReceivedRaw:'1000000000',
 ourInputLamports:'50000000',ourQuotedTokensOutRaw:'495000000',
 quoteSlippageBps:100,alreadyReserved:false
};
test('fresh verified caller BUY and not-chased $10 quote are shadow eligible',()=>{
 const result=screenEchoFastFollower(candidate);
 assert.equal(result.eligible,true);
 if(result.eligible){
  assert.equal(result.callerBuyAgeMs,600);
  assert.equal(result.quoteAgeMs,100);
  assert.equal(result.signingApproved,false);
  assert.ok(result.priceMarkupBps>0&&result.priceMarkupBps<300);
  assert.ok(result.worstCaseMarkupBps>result.priceMarkupBps&&result.worstCaseMarkupBps<=300);
 }
 assert.equal(ECHO_FAST_FOLLOWER_SIGNING_ENABLED,false);
});
test('price pump exceeding 3% is rejected, even when quote reports low slippage',()=>{
 const result=screenEchoFastFollower({...candidate,ourQuotedTokensOutRaw:'450000000',quoteSlippageBps:50});
 assert.deepEqual(result,{eligible:false,reason:'WORST_CASE_PRICE_ALREADY_RAN',signingApproved:false});
});
test('3% slippage plus 1% quote markup must fail total entry cap',()=>{
 const result=screenEchoFastFollower({...candidate,quoteSlippageBps:300});
 assert.deepEqual(result,{eligible:false,reason:'WORST_CASE_PRICE_ALREADY_RAN',signingApproved:false});
});
test('slow observation and old quote never chase stale caller buys',()=>{
 const old=screenEchoFastFollower({...candidate,nowMs:start+6000,quoteObservedAtMs:start+5900});
 assert.deepEqual(old,{eligible:false,reason:'CALLER_BUY_TOO_OLD',signingApproved:false});
 const quote=screenEchoFastFollower({...candidate,nowMs:start+2100});
 assert.deepEqual(quote,{eligible:false,reason:'STALE_ENTRY_QUOTE',signingApproved:false});
});
test('duplicate, unverified signer, excessive slippage and 0.1 SOL cap deny',()=>{
 for(const [change,reason] of [
  [{alreadyReserved:true},'DUPLICATE_TOKEN'],
  [{quoteMint:'4'.repeat(44)},'MINT_MISMATCH'],
  [{callerVerified:false},'UNVERIFIED_CALLER_SWAP'],
  [{quoteSlippageBps:301},'EXCESSIVE_QUOTE_SLIPPAGE'],
  [{ourInputLamports:'100000001'},'EXCEEDS_0_1_SOL_CAP'],
  [{ourQuotedTokensOutRaw:'0'},'UNVERIFIED_PRICE_QUANTITIES']
 ] as const){
  const result=screenEchoFastFollower({...candidate,...change});
  assert.deepEqual(result,{eligible:false,reason,signingApproved:false});
 }
});
test('invalid clock order and quote in the future deny',()=>{
 assert.equal(screenEchoFastFollower({...candidate,detectionAtMs:start-1}).eligible,false);
 assert.equal(screenEchoFastFollower({...candidate,quoteObservedAtMs:start+10000}).eligible,false);
});
