import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveEchoFastFollowerShadow,ECHO_FAST_FOLLOWER_EXECUTION_ENABLED}
 from '../src/echo/fastFollowerShadowAdmission.js';
import type {EchoAtomicPositionStore} from '../src/echo/atomicPilotReservation.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
const now=1762000000900,mint='2'.repeat(44);
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const candidate={
 callerBuySignature:'3'.repeat(64),callerVerified:true,
 callerMint:mint,quoteMint:mint,
 callerInputMint:'So11111111111111111111111111111111111111112',
 ourInputMint:'So11111111111111111111111111111111111111112',callerBoughtAtMs:now-500,
 detectionAtMs:now-300,nowMs:now,quoteObservedAtMs:now-100,
 callerSpentLamports:'100000000',callerTokensReceivedRaw:'1000000000',
 ourInputLamports:'50000000',ourQuotedTokensOutRaw:'495000000',
 quoteSlippageBps:100,alreadyReserved:false
};
const pilot={
 callerWallet:SLINGOOR_WALLET,mint,verifiedBuyerSigner:true,
 originalSwapSucceeded:true,verifiedSpend:true,verifiedTokenCredit:true,
 priceSolUsd:200,priceObservedAtMs:now-200,nowMs:now,
 spentOrdersToday:0,openOrPendingPositions:0,openOrPendingPrincipalUsd:0,
 alreadyReservedOrPurchased:false,killSwitchEngaged:false,maxFeeLamports:100000
};
test('fresh matched caller quote admits only a shadow reservation, no signing',async()=>{
 let reservations=0;
 const store:EchoAtomicPositionStore={reserveIfCapacity:async(l)=>{
  reservations++;assert.equal(l.principalUsd,10);
  assert.equal(l.amountLamports,50_000_000);
  return {reserved:true,key:l.executionWallet+':'+l.mint};
 }};
 const result=await reserveEchoFastFollowerShadow({candidate,pilot,executionWallet:wallet,store});
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.mode,'SHADOW_RESERVED_ONLY');
  assert.equal(result.amountLamports,50_000_000);
  assert.equal(result.signingApproved,false);
 }
 assert.equal(reservations,1);
 assert.equal(ECHO_FAST_FOLLOWER_EXECUTION_ENABLED,false);
});
test('price chase, stale quote, inaccurate amount and wrong mint never reserve',async()=>{
 let reservations=0;
 const store:EchoAtomicPositionStore={reserveIfCapacity:async()=>{
  reservations++;return {reserved:true,key:'dummy'};
 }};
 for(const change of [
  {candidate:{...candidate,ourQuotedTokensOutRaw:'440000000'},pilot},
  {candidate:{...candidate,quoteObservedAtMs:now-2000},pilot},
  {candidate:{...candidate,ourInputLamports:'60000000'},pilot},
  {candidate:{...candidate,quoteMint:'4'.repeat(44)},pilot},
  {candidate:{...candidate,callerInputMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'},pilot},
  {candidate,pilot:{...pilot,verifiedSpend:false}}
 ]){
  const result=await reserveEchoFastFollowerShadow({...change,executionWallet:wallet,store});
  assert.equal(result.ok,false);
 }
 assert.equal(reservations,0);
});
test('atomic database rejection never produces shadow approval',async()=>{
 const store:EchoAtomicPositionStore={reserveIfCapacity:async()=>({
  reserved:false,reason:'TWO_SLOTS_FULL'
 })};
 const result=await reserveEchoFastFollowerShadow({candidate,pilot,executionWallet:wallet,store});
 assert.deepEqual(result,{ok:false,reason:'TWO_SLOTS_FULL',signingApproved:false});
});
