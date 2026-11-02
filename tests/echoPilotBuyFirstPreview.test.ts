import test from 'node:test';
import assert from 'node:assert/strict';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import {previewEchoBuyFirst,ECHO_BUY_FIRST_LIVE_ENABLED}
 from '../src/echo/pilotBuyFirstPreview.js';
import type {EchoJupiterV2PreviewRequest,EchoJupiterV2PreviewResult}
 from '../src/echo/readOnlyJupiterV2Swap.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump';
const now=1800000000000;
const base={
 executionWallet:wallet,rpcUrl:'https://example.invalid',jupiterApiKey:'fixture',
 sameWalletManualExitAccessVerified:true,manualExitRiskAcknowledged:true,
 order:{callerWallet:SLINGOOR_WALLET,mint,verifiedBuyerSigner:true,
  originalSwapSucceeded:true,verifiedSpend:true,verifiedTokenCredit:true,
  priceSolUsd:200,priceObservedAtMs:now,nowMs:now,spentOrdersToday:0,
  openOrPendingPositions:0,openOrPendingPrincipalUsd:0,
  alreadyReservedOrPurchased:false,killSwitchEngaged:false,maxFeeLamports:500000},
 budget:{spendableWalletCents:'3500',reservedAndOpenCents:'0',cumulativeCommittedCents:'0',
  newPrincipalCents:'940',allInBuyCostsCents:'60',exitAndNetworkReserveCents:'100',
  openOrPendingPositions:0,killSwitch:false,verifiedFreshSolUsd:true,
  verifiedBuyAndSellRoutes:true,durableReservationReady:true}
};
const fake=(r:EchoJupiterV2PreviewRequest):EchoJupiterV2PreviewResult=>({
 ok:true,reason:'RPC_SIMULATION_SUCCEEDED',side:'BUY',
 inputMint:'So11111111111111111111111111111111111111112',outputMint:mint,
 inputRaw:r.amountRaw,quotedOutputRaw:'1200000',requestId:'mock',logs:[],
 unsignedTransactionSha256:'a'.repeat(64),unitsConsumed:110000,
 unsignedAudit:{feeEstimateComplete:true,feePayer:wallet} as any
});
test('BUY-first preview omits Telegram SELL simulation but never signs or broadcasts',async()=>{
 const calls:EchoJupiterV2PreviewRequest[]=[];
 const r=await previewEchoBuyFirst(base,async x=>{calls.push(x);return fake(x);});
 assert.equal(r.eligible,true);assert.equal(r.executable,false);
 assert.equal(r.reason,'BUY_PREVIEW_ONLY_NO_SIGNING');
 assert.equal(ECHO_BUY_FIRST_LIVE_ENABLED,false);
 assert.equal(calls.length,1);assert.equal(calls[0].side,'BUY');
 assert.equal(calls[0].maxSlippageBps,1000);
 assert.equal(calls[0].amountRaw,'47000000');
});
test('missing same-wallet app exit access blocks preview before network',async()=>{
 let calls=0;
 for(const changed of [
  {sameWalletManualExitAccessVerified:false},
  {manualExitRiskAcknowledged:false},
  {budget:{...base.budget,cumulativeCommittedCents:'2700'}},
  {order:{...base.order,openOrPendingPositions:2}},
  {order:{...base.order,alreadyReservedOrPurchased:true}}
 ]){
  const r=await previewEchoBuyFirst({...base,...changed},
   async x=>{calls++;return fake(x);});
  assert.equal(r.eligible,false);assert.equal(r.executable,false);
 }
 assert.equal(calls,0);
});
test('failed BUY simulation is never treated as authority to spend',async()=>{
 const r=await previewEchoBuyFirst(base,async()=>({
  ok:false,reason:'RPC_SIMULATION_FAILED'}));
 assert.equal(r.eligible,false);assert.equal(r.reason,'BUY_RPC_SIMULATION_FAILED');
});
