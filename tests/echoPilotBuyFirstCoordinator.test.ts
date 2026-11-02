import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoTradeStateJournal} from '../src/echo/tradeStateJournal.js';
import {prepareEchoBuyFirstCoordinator,
 ECHO_BUY_FIRST_COORDINATOR_LIVE_ENABLED} from '../src/echo/pilotBuyFirstCoordinator.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import type {EchoAllInPilotStore} from '../src/echo/allInPilotReservation.js';
import type {EchoJupiterV2PreviewRequest,EchoJupiterV2PreviewResult}
 from '../src/echo/readOnlyJupiterV2Swap.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump';
const when=1800000000000;
const plan={
 executionWallet:wallet,rpcUrl:'https://example.invalid',jupiterApiKey:'fixture',
 sameWalletManualExitAccessVerified:true,manualExitRiskAcknowledged:true,
 marketCapUsd:45000,marketCapObservedAtMs:when-200,
 callerEntryPriceSolPerToken:0.03,tokenDecimals:6,
 order:{callerWallet:SLINGOOR_WALLET,mint,verifiedBuyerSigner:true,
  originalSwapSucceeded:true,verifiedSpend:true,verifiedTokenCredit:true,
  priceSolUsd:200,priceObservedAtMs:when,nowMs:when,spentOrdersToday:0,
  openOrPendingPositions:0,openOrPendingPrincipalUsd:0,
  alreadyReservedOrPurchased:false,killSwitchEngaged:false,maxFeeLamports:500000},
 budget:{spendableWalletCents:'3500',reservedAndOpenCents:'0',cumulativeCommittedCents:'0',
  newPrincipalCents:'940',allInBuyCostsCents:'60',exitAndNetworkReserveCents:'100',
  openOrPendingPositions:0,killSwitch:false,verifiedFreshSolUsd:true,
  verifiedBuyAndSellRoutes:true,durableReservationReady:true}
};
const preview=(req:EchoJupiterV2PreviewRequest):Promise<EchoJupiterV2PreviewResult>=>Promise.resolve({
 ok:true,reason:'RPC_SIMULATION_SUCCEEDED',side:'BUY',
 inputMint:'So11111111111111111111111111111111111111112',outputMint:mint,
 inputRaw:req.amountRaw,quotedOutputRaw:'120000',requestId:'fixture',
 unsignedTransactionSha256:'a'.repeat(64),logs:[],unitsConsumed:90000,
 unsignedAudit:{feeEstimateComplete:true,feePayer:wallet} as any
});
const sig='3'.repeat(64);
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'echo-buy-first-'));
 const journal=new EchoTradeStateJournal(join(dir,'state.json'));await journal.load();
 let reservations=0;
 const store:EchoAllInPilotStore={async reserveAllIn(input){
  reservations++;
  assert.equal(input.plan.order.mint,mint);
  assert.equal(input.plan.budget.newPrincipalCents,'940');
  return {reserved:true,key:wallet+':'+mint};
 }};
 return {dir,journal,store,reservations:()=>reservations,provider:{
  async getVerifiedPlan(){return {plan,callerSignature:sig,
   proof:{balanceVerifiedAtIso:new Date().toISOString()}};}
 }};
}
test('BUY-only route reserves once, journals, never signs or sends',async()=>{
 const f=await fixture();
 try{
  const args={provider:f.provider,store:f.store,journal:f.journal,preview};
  const done=await prepareEchoBuyFirstCoordinator(args);
  assert.equal(done.prepared,true);
  assert.equal(done.executable,false);
  assert.equal(ECHO_BUY_FIRST_COORDINATOR_LIVE_ENABLED,false);
  assert.equal(f.journal.get(wallet+':'+mint)?.state,'SIMULATED');
  assert.equal(f.reservations(),1);
  const next=await prepareEchoBuyFirstCoordinator(args);
  assert.equal(next.prepared,false);
  assert.equal(f.reservations(),2);
  const restored=new EchoTradeStateJournal(join(f.dir,'state.json'));
  await restored.load();assert.equal(restored.get(wallet+':'+mint)?.state,'SIMULATED');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('failed simulation and unverified wallet exit never touch SQL',async()=>{
 const f=await fixture();
 try{
  const blocked=await prepareEchoBuyFirstCoordinator({...f,provider:{
   async getVerifiedPlan(){return {plan:{...plan,sameWalletManualExitAccessVerified:false},
    callerSignature:sig,proof:{balanceVerifiedAtIso:new Date().toISOString()}};}
  },preview});
  assert.equal(blocked.prepared,false);assert.equal(f.reservations(),0);
  const failed=await prepareEchoBuyFirstCoordinator({...f,
   preview:async()=>({ok:false,reason:'SIMULATION_FAILED'})});
  assert.equal(failed.prepared,false);assert.equal(f.reservations(),0);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('database outage leaves journal untouched and never authorizes execution',async()=>{
 const f=await fixture();
 try{
  const result=await prepareEchoBuyFirstCoordinator({...f,
   store:{async reserveAllIn(){throw Error('DB DOWN');}},preview});
  assert.equal(result.prepared,false);
  assert.equal(result.reason,'ATOMIC_DATABASE_UNAVAILABLE');
  assert.equal(f.journal.get(wallet+':'+mint),null);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
