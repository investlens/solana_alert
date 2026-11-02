import test from 'node:test';
import assert from 'node:assert/strict';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import {previewEchoPilotRoundTrip} from '../src/echo/pilotRoundTripPreview.js';
import type {EchoJupiterV2PreviewRequest, EchoJupiterV2PreviewResult} from '../src/echo/readOnlyJupiterV2Swap.js';
const mint='So11111111111111111111111111111111111111113';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const now=1800000000000;
const source={
 order:{callerWallet:SLINGOOR_WALLET,mint,verifiedBuyerSigner:true,
  originalSwapSucceeded:true,verifiedSpend:true,verifiedTokenCredit:true,
  priceSolUsd:200,priceObservedAtMs:now,nowMs:now,spentOrdersToday:0,
  openOrPendingPositions:0,openOrPendingPrincipalUsd:0,
  alreadyReservedOrPurchased:false,killSwitchEngaged:false,maxFeeLamports:500000},
 budget:{spendableWalletCents:'3500',reservedAndOpenCents:'0',cumulativeCommittedCents:'0',
  newPrincipalCents:'940',allInBuyCostsCents:'60',exitAndNetworkReserveCents:'100',
  openOrPendingPositions:0,killSwitch:false,verifiedFreshSolUsd:true,
  verifiedBuyAndSellRoutes:true,durableReservationReady:true},
 executionWallet:wallet,rpcUrl:'https://example.invalid',jupiterApiKey:'test-only',
 heldTokenAmountRaw:'12345',
 manualSell:{ownerChatId:'123',senderId:123,chatId:123,mint,percent:100 as const,
  verifiedTokenBalanceRaw:'12345',heldPositionVerified:true,activeSellReservation:false,
  quoteVerified:true,simulationPassed:true}
};
const good=(r:EchoJupiterV2PreviewRequest):EchoJupiterV2PreviewResult=>({
 ok:true,reason:'RPC_SIMULATION_SUCCEEDED',side:r.side,
 inputMint:r.side==='BUY'?'So11111111111111111111111111111111111111112':mint,
 outputMint:r.side==='BUY'?mint:'So11111111111111111111111111111111111111112',
 inputRaw:r.amountRaw,quotedOutputRaw:'999',requestId:'mock',
 logs:[],unitsConsumed:120000,unsignedTransactionSha256:r.side==='BUY'?'buyhash':'sellhash',
 unsignedAudit:{feeEstimateComplete:true,feePayer:wallet} as any
});
test('runs two read-only route previews and never permits execution',async()=>{
 const sides:string[]=[];
 const r=await previewEchoPilotRoundTrip(source,async args=>{
   sides.push(args.side);return good(args);
 });
 assert.deepEqual(sides,['BUY','SELL']);
 assert.equal(r.ok,true);assert.equal(r.executable,false);
 assert.equal(r.buySimulationPassed,true);assert.equal(r.sellSimulationPassed,true);
 assert.equal(r.buyQuoteHash,'buyhash');
});
test('refuses over-budget orders without querying a provider',async()=>{
 let count=0;
 const r=await previewEchoPilotRoundTrip({...source,budget:{
  ...source.budget,cumulativeCommittedCents:'2500'}},async args=>{count++;return good(args)});
 assert.equal(r.ok,false);assert.equal(count,0);
});
test('manual SELL authorization must match owner and verified balance',async()=>{
 let count=0;
 const r=await previewEchoPilotRoundTrip({...source,manualSell:{
  ...source.manualSell,senderId:987}},async args=>{count++;return good(args)});
 assert.equal(r.reason,'SELL_OWNER_ONLY');assert.equal(count,0);
 const other=await previewEchoPilotRoundTrip({...source,heldTokenAmountRaw:'12346'},
  async args=>{count++;return good(args)});
 assert.equal(other.reason,'SELL_POSITION_MISMATCH');assert.equal(count,0);
});
test('BUY failure means SELL preview is never requested',async()=>{
 const sides:string[]=[];
 const r=await previewEchoPilotRoundTrip(source,async args=>{
  sides.push(args.side);return {ok:false,reason:'JUPITER_ORDER_UNAVAILABLE'};
 });
 assert.equal(r.ok,false);assert.deepEqual(sides,['BUY']);assert.equal(r.executable,false);
});
test('SELL simulation failure remains blocked even if BUY succeeded',async()=>{
 const r=await previewEchoPilotRoundTrip(source,async args=>
  args.side==='BUY'?good(args):{ok:false,reason:'RPC_SIMULATION_FAILED'});
 assert.equal(r.reason,'SELL_RPC_SIMULATION_FAILED');
 assert.equal(r.buySimulationPassed,true);assert.equal(r.sellSimulationPassed,false);
 assert.equal(r.ok,false);assert.equal(r.executable,false);
});
