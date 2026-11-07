import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEchoPhantomSellReserve,ECHO_SELL_RESERVE_CAN_SELL}
 from '../src/echo/phantomSellReserveReview.js';
const now=1800000000000;
const base={
 wallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',
 mint:'GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump',
 outputMint:'So11111111111111111111111111111111111111112',
 quoteObservedAtMs:now-500,nowMs:now,
 walletTokenBalanceRaw:'900000',quotedSellInputRaw:'900000',
 minimumSolOutputLamports:'1500000',networkAndPriorityFeeUpperLamports:'10000',
 accountRentUpperLamports:'2000000',extraCpiUpperLamports:'100000',
 walletSolBalanceLamports:'5000000',existingReservedExitLamports:'2000000',
 quoteIndependentlyFetched:true,feeAndCpiIndependentlyBounded:true,
 poolAndTokenOwnersVerified:true,exactManualTransactionPreviewVerified:true
};
test('independent manual exit quote reserves costs without signing or selling',()=>{
 const r=reviewEchoPhantomSellReserve(base);
 assert.deepEqual(r,{ok:true,mode:'READ_ONLY_MANUAL_EXIT_RESERVE',
  requiredLamports:'2110000',quoteExpiresAtMs:now+1500,
  verifiedRealPhantomSell:false,signingAllowed:false,broadcastAllowed:false});
 assert.equal(ECHO_SELL_RESERVE_CAN_SELL,false);
});
test('partial sell, unfunded reserve and untrusted evidence fail closed',()=>{
 for(const patch of [
  {quotedSellInputRaw:'100000'},{walletSolBalanceLamports:'4000000'},
  {quoteIndependentlyFetched:false},{feeAndCpiIndependentlyBounded:false},
  {poolAndTokenOwnersVerified:false},{exactManualTransactionPreviewVerified:false},
  {quoteObservedAtMs:now-2001},{outputMint:'not-sol'},
  {walletTokenBalanceRaw:'0'},{extraCpiUpperLamports:'UNKNOWN'}
 ]){
  const r=reviewEchoPhantomSellReserve({...base,...patch});
  assert.equal(r.ok,false,JSON.stringify(patch));
  assert.equal(r.broadcastAllowed,false);
 }
});
