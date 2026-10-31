import test from 'node:test';
import assert from 'node:assert/strict';
import {createEchoTrustedSupabaseReader} from '../src/echo/supabaseTrustedReservationReader.js';
import type {SupabaseClient} from '@supabase/supabase-js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',mint='2'.repeat(44);
const row={execution_wallet:wallet,mint,state:'reserved',amount_lamports:50000000,
 position_closed_at:null,transaction_signature:null};
function mock(data:unknown,error:unknown=null){
 const eqs:string[]=[];
 const client={from:(table:string)=>{
  assert.equal(table,'echo_live_buy_intents');
  return {select:(cols:string)=>{
   assert.match(cols,/position_closed_at/);
   return {eq:(name:string,value:string)=>{
    eqs.push(name+':'+value);
    const api={eq:(nextName:string,nextValue:string)=>{
     eqs.push(nextName+':'+nextValue);
     return {maybeSingle:async()=>({data,error})};
    }};
    return api;
   }};
  }};
 }} as unknown as SupabaseClient;
 return {client,eqs};
}
test('server-owned reservation reader maps trusted row and binds wallet/mint',async()=>{
 const {client,eqs}=mock(row);
 const r=await createEchoTrustedSupabaseReader(client).getByWalletAndMint(wallet,mint);
 assert.deepEqual(r,{executionWallet:wallet,mint,state:'reserved',amountLamports:50000000,
  positionClosedAt:null,transactionSignature:null});
 assert.deepEqual(eqs,['execution_wallet:'+wallet,'mint:'+mint]);
});
test('missing reservation remains missing, database errors fail closed',async()=>{
 const absent=mock(null);
 assert.equal(await createEchoTrustedSupabaseReader(absent.client).getByWalletAndMint(wallet,mint),null);
 const failed=mock(null,{message:'unavailable'});
 await assert.rejects(()=>createEchoTrustedSupabaseReader(failed.client).getByWalletAndMint(wallet,mint));
});
