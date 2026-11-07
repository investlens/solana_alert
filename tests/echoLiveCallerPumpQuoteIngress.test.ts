import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLiveCallerForPumpQuote,ECHO_LIVE_CALLER_INGRESS_CAN_BROADCAST}
 from '../src/echo/liveCallerPumpQuoteIngress.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import type {EchoFiveDollarCall} from '../src/echo/fiveDollarCallPolicy.js';
import type {EchoSignal} from '../src/echo/signals.js';
const now=1_800_000_000_000;
const mint='So11111111111111111111111111111111111111113';
const signature='2'.repeat(64);
const signal:EchoSignal={id:signature+':'+SLINGOOR_WALLET+':'+mint+':BUY',
 wallet:SLINGOOR_WALLET,caller:'WHALE · slingoor',signature,
 timestamp:now/1000-1,mint,side:'BUY',tokenAmount:12000,
 quoteAmount:.005,quoteSymbol:'SOL',quoteBasis:'token-account net change'};
const call:EchoFiveDollarCall={
 executionWallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',
 callerWallet:SLINGOOR_WALLET,mint,sourceSignature:signature,
 side:'BUY',verifiedCallerSigner:true,verifiedSwap:true,verifiedSpend:true,
 verifiedTokenCredit:true,isTransferOrGift:false,marketCapUsd:50000,
 callerPriceSolPerToken:.000001,buyPriceSolPerToken:.0000012,
 maxSlippageBps:1000,nowMs:now,observedAtMs:now-100,
 marketCapObservedAtMs:now,balanceVerifiedAtMs:now,solUsdObservedAtMs:now,
 principalLamports:'20000000',networkAndPriorityFeeLamports:'50000',
 accountRentLamports:'2000000',additionalCpiDebitLamports:'100000',
 sellReserveLamports:'2000000',pendingWalletDebitLamports:'0',
 availableWalletLamports:'100000000',solUsdPriceCents:'20000',
 exactMessageAndCpiAudited:true,manualSellRouteAndReserveVerified:true,
 walletBalanceAndFxVerified:true,durableReservationAvailable:true,
 killSwitch:false,openOrPendingLots:9,sourceTransactionAlreadyReserved:false
};
const args={signal,nowMs:now,verifiedAtMs:now,
 websocketObservedAtMs:now-400,historicalReplay:false};
test('verified live caller can enter independent quote review; never executable',async()=>{
 let requests=0;
 const r=await inspectLiveCallerForPumpQuote({...args,
  provider:{readIndependentlyVerifiedCall:async input=>{
   requests++;assert.equal(input.sourceSignature,signature);
   assert.equal(input.mint,mint);return call;
  }}});
 assert.equal(r.status,'VERIFIED_NO_BROADCAST',JSON.stringify(r));
 assert.equal(r.source?.call.openOrPendingLots,9);
 assert.equal(r.canSign,false);assert.equal(r.canBroadcast,false);
 assert.equal(requests,1);
 assert.equal(ECHO_LIVE_CALLER_INGRESS_CAN_BROADCAST,false);
});
test('missing independently owned provider is an explicit blocker',async()=>{
 const r=await inspectLiveCallerForPumpQuote({...args,provider:null});
 assert.equal(r.reason,'TRUSTED_PUMP_PROVIDER_NOT_CONNECTED');
 assert.equal(r.source,null);
 assert.equal(r.canBroadcast,false);
});
test('historical replay, transfer, stale call and invalid quote never invoke provider',async()=>{
 let called=0;
 const provider={readIndependentlyVerifiedCall:async()=>{
  called++;return call;}};
 for(const change of [
  {historicalReplay:true},
  {signal:{...signal,side:'SELL' as const}},
  {signal:{...signal,timestamp:now/1000-5}},
  {signal:{...signal,quoteAmount:null}},
  {signal:{...signal,quoteBasis:'unavailable' as const}},
  {websocketObservedAtMs:null}
 ]){
  const r=await inspectLiveCallerForPumpQuote({...args,provider,...change});
  assert.equal(r.status,'BLOCKED',JSON.stringify(change));
 }
 assert.equal(called,0);
});
test('unverified fee evidence, over-cap mint and foreign source reject',async()=>{
 for(const change of [
  {marketCapUsd:100000},
  {exactMessageAndCpiAudited:false},
  {sourceSignature:'3'.repeat(64)},
  {callerWallet:'3'.repeat(44)}
 ]){
  const r=await inspectLiveCallerForPumpQuote({...args,
   provider:{readIndependentlyVerifiedCall:async()=>({...call,...change})}});
  assert.equal(r.status,'BLOCKED',JSON.stringify(change));
  assert.equal(r.canBroadcast,false);
 }
});
