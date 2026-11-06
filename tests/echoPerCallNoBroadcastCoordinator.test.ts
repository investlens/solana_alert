import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEchoPerCallNoBroadcast,ECHO_PER_CALL_PIPELINE_CAN_SIGN,
 ECHO_PER_CALL_PIPELINE_CAN_BROADCAST,type EchoPerCallTrustedInput} from '../src/echo/perCallNoBroadcastCoordinator.js';
import {screenEchoFiveDollarCall,type EchoFiveDollarCall} from '../src/echo/fiveDollarCallPolicy.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
const now=1_800_000_000_000;
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='So11111111111111111111111111111111111111113';
const signatureA='2'.repeat(64),signatureB='3'.repeat(64);
function verified(signature=signatureA):EchoPerCallTrustedInput{
 const call:EchoFiveDollarCall={
  executionWallet:wallet,callerWallet:SLINGOOR_WALLET,mint,
  sourceSignature:signature,side:'BUY',verifiedCallerSigner:true,
  verifiedSwap:true,verifiedSpend:true,verifiedTokenCredit:true,isTransferOrGift:false,
  marketCapUsd:450000,callerPriceSolPerToken:.000001,
  buyPriceSolPerToken:.0000013,maxSlippageBps:1000,
  observedAtMs:now-800,nowMs:now,
  marketCapObservedAtMs:now,balanceVerifiedAtMs:now,solUsdObservedAtMs:now,
  principalLamports:'20000000',networkAndPriorityFeeLamports:'50000',
  accountRentLamports:'2000000',additionalCpiDebitLamports:'100000',
  sellReserveLamports:'2000000',pendingWalletDebitLamports:'0',
  availableWalletLamports:'100000000',solUsdPriceCents:'20000',
  exactMessageAndCpiAudited:true,manualSellRouteAndReserveVerified:true,
  walletBalanceAndFxVerified:true,durableReservationAvailable:true,
  killSwitch:false,openOrPendingLots:10,sourceTransactionAlreadyReserved:false
 };
 return {call,chainAtMs:now-800,websocketObservedAtMs:now-500,verifiedAtMs:now-100};
}
test('genuine distinct calls reserve separate per-call keys, do not sign or broadcast',async()=>{
 const observedKeys:string[]=[];
 let clock=now;
 const store={reserve:async(call:EchoFiveDollarCall)=>{
  const result=screenEchoFiveDollarCall(call);
  assert.equal(result.eligible,true);
  if(!result.eligible)throw Error('unreachable');
  observedKeys.push(result.intentKey);
  clock+=200;
  return {reserved:true as const,key:result.intentKey,executable:false as const};
 }};
 const a=await prepareEchoPerCallNoBroadcast({source:{getVerifiedBuyAndQuote:async()=>verified()},
  store,now:()=>clock,manualAutoBuyEnabled:true});
 clock=now;
 const b=await prepareEchoPerCallNoBroadcast({source:{getVerifiedBuyAndQuote:async()=>verified(signatureB)},
  store,now:()=>clock,manualAutoBuyEnabled:true});
 assert.equal(a.reserved,true);
 assert.equal(b.reserved,true);
 assert.equal(a.executable,false);
 assert.equal(a.broadcastAllowed,false);
 assert.equal(a.timing?.chainToReservedMs,1000);
 assert.equal(a.timing?.meetsThreeSecondTarget,true);
 assert.equal(a.timing?.signedAtMs,null);
 assert.equal(a.timing?.submittedAtMs,null);
 assert.notEqual(observedKeys[0],observedKeys[1]);
 assert.equal(ECHO_PER_CALL_PIPELINE_CAN_SIGN,false);
 assert.equal(ECHO_PER_CALL_PIPELINE_CAN_BROADCAST,false);
});
test('owner OFF prevents all external calls',async()=>{
 let calls=0;
 const result=await prepareEchoPerCallNoBroadcast({
  source:{getVerifiedBuyAndQuote:async()=>{calls++;return verified();}},
  store:{reserve:async()=>{calls++;throw Error('unreachable');}},
  now:()=>now,manualAutoBuyEnabled:false
 });
 assert.equal(result.reason,'OWNER_AUTO_BUY_OFF');
 assert.equal(result.reserved,false);
 assert.equal(calls,0);
});
test('missing independent quote, stale price and over-cap mint fail before SQL',async()=>{
 let reserveCalls=0;
 const store={reserve:async()=>{reserveCalls++;throw Error('not reached');}};
 for(const change of [
  {marketCapUsd:500001},{exactMessageAndCpiAudited:false},
  {sourceTransactionAlreadyReserved:true},{balanceVerifiedAtMs:now-3100},
  {availableWalletLamports:'1'}
 ]){
  const input=verified();Object.assign(input.call,change);
  const result=await prepareEchoPerCallNoBroadcast({
   source:{getVerifiedBuyAndQuote:async()=>input},store,now:()=>now,manualAutoBuyEnabled:true
  });
  assert.equal(result.reserved,false,JSON.stringify(change));
 }
 assert.equal(reserveCalls,0);
});
test('trusted provider outage and missing DB are no-broadcast failures',async()=>{
 const store={reserve:async()=>{throw Error('DB_DOWN');}};
 const absent=await prepareEchoPerCallNoBroadcast({
  source:{getVerifiedBuyAndQuote:async()=>{throw Error('no quote');}},store,
  now:()=>now,manualAutoBuyEnabled:true});
 assert.equal(absent.reason,'TRUSTED_CHAIN_QUOTE_UNAVAILABLE');
 const db=await prepareEchoPerCallNoBroadcast({
  source:{getVerifiedBuyAndQuote:async()=>verified()},store,
  now:()=>now,manualAutoBuyEnabled:true});
 assert.equal(db.reason,'ATOMIC_RESERVATION_UNAVAILABLE');
 assert.equal(db.broadcastAllowed,false);
});
test('a slow but verified reservation reports missed 3s target, never forges submission',async()=>{
 let clock=now;
 const input=verified();
 const key=screenEchoFiveDollarCall(input.call);
 assert.equal(key.eligible,true);
 if(!key.eligible)throw Error('unreachable');
 const result=await prepareEchoPerCallNoBroadcast({
  source:{getVerifiedBuyAndQuote:async()=>input},
  store:{reserve:async()=>{clock=now+2400;return {
   reserved:true as const,key:key.intentKey,executable:false as const};}},
  now:()=>clock,manualAutoBuyEnabled:true});
 assert.equal(result.reserved,true);
 assert.equal(result.timing?.chainToReservedMs,3200);
 assert.equal(result.timing?.meetsThreeSecondTarget,false);
 assert.equal(result.timing?.submittedAtMs,null);
});
