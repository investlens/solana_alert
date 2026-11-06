/** Read-only coordinator adapter for draft per-source $5 SQL reservation.
 * The RPC itself serializes reservations across replicas. Never fall back to
 * legacy one-buy-per-mint RPC, no sign/send, no service credentials in client.
 */
import type {SupabaseClient} from '@supabase/supabase-js';
import {screenEchoFiveDollarCall,type EchoFiveDollarCall} from './fiveDollarCallPolicy.js';
export type EchoFiveDollarStoreResult=
 |{reserved:true;key:string;executable:false}
 |{reserved:false;reason:string;executable:false};
export function createEchoFiveDollarCallStore(client:SupabaseClient){
 return {async reserve(input:EchoFiveDollarCall):Promise<EchoFiveDollarStoreResult>{
  const decision=screenEchoFiveDollarCall(input);
  if(!decision.eligible)return {reserved:false,reason:decision.reason,executable:false};
  // Supabase JSON represents JS numbers, so reject any lamport/cents integer
  // outside Number.MAX_SAFE_INTEGER rather than silently rounding the debit.
  for(const raw of [input.principalLamports,input.networkAndPriorityFeeLamports,
    input.accountRentLamports,input.additionalCpiDebitLamports,
    input.sellReserveLamports,input.availableWalletLamports,input.solUsdPriceCents]){
    if(!Number.isSafeInteger(Number(raw)))
      return {reserved:false,reason:'UNSAFE_INTEGER_AT_DATABASE_BOUNDARY',executable:false};
  }
  try{
   const {data,error}=await client.rpc('echo_reserve_five_usd_distinct_call',{
    p_execution_wallet:input.executionWallet,
    p_caller_wallet:input.callerWallet,
    p_source_signature:input.sourceSignature,
    p_mint:input.mint,
    p_amount_lamports:Number(input.principalLamports),
    p_exact_fee_lamports:Number(input.networkAndPriorityFeeLamports),
    p_account_rent_lamports:Number(input.accountRentLamports),
    p_extra_cpi_lamports:Number(input.additionalCpiDebitLamports),
    p_exit_reserve_lamports:Number(input.sellReserveLamports),
    p_sol_usd_cents:Number(input.solUsdPriceCents),
    p_spendable_wallet_lamports:Number(input.availableWalletLamports),
    p_balance_verified_at:new Date(input.balanceVerifiedAtMs).toISOString()
   });
   if(error||typeof data!=='string')return {reserved:false,reason:'DATABASE_UNAVAILABLE',executable:false};
   if(data==='RESERVED')return {reserved:true,key:decision.intentKey,executable:false};
   return {reserved:false,reason:data.slice(0,90),executable:false};
  }catch{return {reserved:false,reason:'DATABASE_UNAVAILABLE',executable:false};}
 }};
}
