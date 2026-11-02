import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import {EchoTradeStateJournal} from '../src/echo/tradeStateJournal.js';
import {prepareEchoPilotBuyAndExit} from '../src/echo/pilotReadOnlyCoordinator.js';
import type {EchoJupiterV2PreviewRequest,EchoJupiterV2PreviewResult} from '../src/echo/readOnlyJupiterV2Swap.js';
import type {EchoAllInPilotStore} from '../src/echo/allInPilotReservation.js';
const mint='So11111111111111111111111111111111111111113';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const now=1800000000000;
const plan={
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
const callerSignature='3'.repeat(64);
const preview=async (r:EchoJupiterV2PreviewRequest):Promise<EchoJupiterV2PreviewResult>=>({
 ok:true,reason:'RPC_SIMULATION_SUCCEEDED',side:r.side,
 inputMint:r.side==='BUY'?'So11111111111111111111111111111111111111112':mint,
 outputMint:r.side==='BUY'?mint:'So11111111111111111111111111111111111111112',
 inputRaw:r.amountRaw,quotedOutputRaw:'999',requestId:'mock',
 logs:[],unitsConsumed:120000,unsignedTransactionSha256:r.side==='BUY'?'buyhash':'sellhash',
 unsignedAudit:{feeEstimateComplete:true,feePayer:wallet} as any
});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'echo-pilot-'));
 const path=join(dir,'journal.json');
 const journal=new EchoTradeStateJournal(path);
 await journal.load();
 let calls=0;
 const stored=new Set<string>();
 const store:EchoAllInPilotStore={async reserveAllIn({plan:next}){
  calls++;
  const key=next.executionWallet+':'+next.order.mint;
  if(stored.has(key))return {reserved:false,reason:'DUPLICATE_TOKEN'};
  stored.add(key);return {reserved:true,key};
 }};
 const provider={async getTrustedPlan(){return {plan,callerSignature,proof:{balanceVerifiedAtIso:new Date().toISOString(),wallet,spendableWalletCents:'3500',solUsdCents:20000,contextSlot:500}};}};
 return {dir,path,journal,provider,store,counts:()=>calls};
}
test('trusted preview reserves once and persists SIMULATED without signing',async()=>{
 const f=await fixture();
 try{
  const first=await prepareEchoPilotBuyAndExit({...f,preview});
  assert.equal(first.prepared,true);assert.equal(first.executable,false);
  assert.equal(first.reason,'PREPARED_READ_ONLY_NO_SIGNING');
  const restarted=new EchoTradeStateJournal(f.path);await restarted.load();
  assert.equal(restarted.get(wallet+':'+mint)?.state,'SIMULATED');
  const repeat=await prepareEchoPilotBuyAndExit({...f,journal:restarted,preview});
  assert.equal(repeat.prepared,false);assert.equal(repeat.reason,'ATOMIC_RESERVATION_DUPLICATE_TOKEN');
  assert.equal(f.counts(),2);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('missing trusted snapshot or failed SELL preview never reserves funds',async()=>{
 const f=await fixture();
 try{
  const denied=await prepareEchoPilotBuyAndExit({
   ...f,provider:{async getTrustedPlan(){throw Error('offline');}},preview});
  assert.equal(denied.reason,'TRUSTED_SNAPSHOT_UNAVAILABLE');
  const failed=await prepareEchoPilotBuyAndExit({...f,preview:async r=>
   r.side==='BUY'?preview(r):{ok:false,reason:'RPC_SIMULATION_FAILED'}});
  assert.equal(failed.prepared,false);assert.equal(f.counts(),0);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('database unavailable fails closed, no journal record written',async()=>{
 const f=await fixture();
 try{
  const store:EchoAllInPilotStore={async reserveAllIn(){throw Error('db down');}};
  const result=await prepareEchoPilotBuyAndExit({...f,store,preview});
  assert.equal(result.reason,'ATOMIC_RESERVATION_DATABASE_UNAVAILABLE');
  assert.equal(f.journal.get(wallet+':'+mint),null);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('missing caller signature fails closed before database reservation',async()=>{
 const f=await fixture();
 try{
  const result=await prepareEchoPilotBuyAndExit({...f,
   provider:{async getTrustedPlan(){return {plan,callerSignature:'invalid',proof:{balanceVerifiedAtIso:new Date().toISOString(),wallet,spendableWalletCents:'3500',solUsdCents:20000,contextSlot:500}};}},preview});
  assert.equal(result.reason,'CALLER_SIGNATURE_NOT_VERIFIED');assert.equal(f.counts(),0);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
