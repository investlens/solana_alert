import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createEchoFiveDollarCallStore} from '../src/echo/fiveDollarCallStore.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import type {EchoFiveDollarCall} from '../src/echo/fiveDollarCallPolicy.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='So11111111111111111111111111111111111111113';
function fixture(sourceSignature='2'.repeat(64)):EchoFiveDollarCall {
 return {
  executionWallet:wallet,callerWallet:SLINGOOR_WALLET,mint,sourceSignature,
  side:'BUY',verifiedCallerSigner:true,verifiedSwap:true,
  verifiedSpend:true,verifiedTokenCredit:true,isTransferOrGift:false,
  marketCapUsd:50000,callerPriceSolPerToken:.00001,buyPriceSolPerToken:.000014,
  maxSlippageBps:1000,observedAtMs:1800000000000,
 marketCapObservedAtMs:1800000000000,balanceVerifiedAtMs:1800000000000,
 solUsdObservedAtMs:1800000000000,nowMs:1800000000000,
  principalLamports:'20000000',networkAndPriorityFeeLamports:'50000',
  accountRentLamports:'2000000',additionalCpiDebitLamports:'100000',
  sellReserveLamports:'2000000',pendingWalletDebitLamports:'0',
  availableWalletLamports:'100000000',solUsdPriceCents:'20000',
  exactMessageAndCpiAudited:true,manualSellRouteAndReserveVerified:true,
  walletBalanceAndFxVerified:true,durableReservationAvailable:true,
  killSwitch:false,openOrPendingLots:0,sourceTransactionAlreadyReserved:false
 };
}
test('a distinct source signature routes to new atomic SQL function, never the legacy function',async()=>{
 const calls:{name:string,args:Record<string,unknown>}[]=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});return {data:'RESERVED',error:null};
 }} as unknown as SupabaseClient;
 const store=createEchoFiveDollarCallStore(client);
 const first=await store.reserve(fixture());
 const second=await store.reserve(fixture('3'.repeat(64)));
 assert.equal(first.reserved,true);
 assert.equal(second.reserved,true);
 if(first.reserved&&second.reserved)assert.notEqual(first.key,second.key);
 assert.deepEqual(calls.map(c=>c.name),[
  'echo_reserve_five_usd_distinct_call','echo_reserve_five_usd_distinct_call'
 ]);
 assert.equal(calls[0].args.p_amount_lamports,20000000);
 assert.equal(calls[0].args.p_extra_cpi_lamports,100000);
});
test('a repeat notification or fee gap cannot reach the RPC',async()=>{
 let count=0;
 const client={rpc:async()=>{count++;return {data:'RESERVED',error:null};}} as unknown as SupabaseClient;
 const store=createEchoFiveDollarCallStore(client);
 assert.equal((await store.reserve({...fixture(),sourceTransactionAlreadyReserved:true})).reserved,false);
 assert.equal((await store.reserve({...fixture(),exactMessageAndCpiAudited:false})).reserved,false);
 assert.equal((await store.reserve({...fixture(),availableWalletLamports:'0'})).reserved,false);
 assert.equal(count,0);
});
test('database reject, no migration or outage fails closed without fallback',async()=>{
 const cases=[{data:'DUPLICATE_SOURCE_TRANSACTION',error:null},
  {data:null,error:{message:'migration absent'}},{data:undefined,error:null}];
 for(const response of cases){
  let calls=0;
  const client={rpc:async()=>{calls++;return response;}} as unknown as SupabaseClient;
  const result=await createEchoFiveDollarCallStore(client).reserve(fixture());
  assert.equal(result.reserved,false);
  assert.equal(result.executable,false);
  assert.equal(calls,1);
 }
});
