import test from 'node:test';
import assert from 'node:assert/strict';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import {createEchoAllInSupabaseStore} from '../src/echo/allInPilotReservation.js';
import type {SupabaseClient} from '@supabase/supabase-js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='So11111111111111111111111111111111111111113';
const now=1800000000000;
const plan={
 executionWallet:wallet,rpcUrl:'https://example.invalid',jupiterApiKey:'mock',
 heldTokenAmountRaw:'1',
 manualSell:{ownerChatId:'1',chatId:1,senderId:1,mint,percent:100 as const,
  verifiedTokenBalanceRaw:'1',heldPositionVerified:true,activeSellReservation:false,
  quoteVerified:true,simulationPassed:true},
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
const signature='3'.repeat(64);
test('adapter uses ONLY fee-inclusive RPC and persists database outcome',async()=>{
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});return {data:'RESERVED',error:null};
 }} as unknown as SupabaseClient;
 const store=createEchoAllInSupabaseStore(client);
 const result=await store.reserveAllIn({
  plan,callerSignature:signature,proof:{balanceVerifiedAtIso:new Date().toISOString(),wallet,spendableWalletCents:'3500',solUsdCents:20000,contextSlot:500}
 });
 assert.equal(result.reserved,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].name,'echo_pilot_reserve_all_in_atomic');
 assert.equal(calls[0].args.p_principal_cents,940);
 assert.equal(calls[0].args.p_buy_cost_ceiling_cents,60);
 assert.equal(calls[0].args.p_exit_reserve_cents,100);
 assert.equal(calls[0].args.p_verified_spendable_wallet_cents,3500);
});
test('missing or stale balance and absent all-in costs prevent all database writes',async()=>{
 let count=0;
 const client={rpc:async()=>{count++;return {data:'RESERVED',error:null};}} as unknown as SupabaseClient;
 const store=createEchoAllInSupabaseStore(client);
 for(const payload of [
  {plan:{...plan,budget:{...plan.budget,allInBuyCostsCents:null}},
   proof:{balanceVerifiedAtIso:new Date().toISOString(),wallet,spendableWalletCents:'3500',solUsdCents:20000,contextSlot:500}},
  {plan,proof:{balanceVerifiedAtIso:'2020-01-01T00:00:00Z',wallet,spendableWalletCents:'3500',solUsdCents:20000,contextSlot:500}}
 ]){
  const r=await store.reserveAllIn({...payload,callerSignature:signature});
  assert.equal(r.reserved,false);
 }
 assert.equal(count,0);
});
test('Supabase error denies reservation, never falls back to legacy function',async()=>{
 const calls:string[]=[];
 const client={rpc:async(name:string)=>{
  calls.push(name);return {data:null,error:{message:'missing migration'}};
 }} as unknown as SupabaseClient;
 const r=await createEchoAllInSupabaseStore(client).reserveAllIn({
  plan,callerSignature:signature,proof:{balanceVerifiedAtIso:new Date().toISOString(),wallet,spendableWalletCents:'3500',solUsdCents:20000,contextSlot:500}
 });
 assert.deepEqual(r,{reserved:false,reason:'DATABASE_UNAVAILABLE'});
 assert.deepEqual(calls,['echo_pilot_reserve_all_in_atomic']);
});
