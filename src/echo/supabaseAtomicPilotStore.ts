/** Server-only Supabase RPC adapter for the reviewed atomic pilot SQL.
 * Never send service-role credentials or signing keys to Telegram/alert workers.
 * Database migration must be separately reviewed/applied before this can work.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EchoAtomicPositionStore, AtomicReservationResult } from './atomicPilotReservation.js';
const resultMap:Record<string,'DUPLICATE_TOKEN'|'TWO_SLOTS_FULL'|'DAILY_LIMIT'>={
 DUPLICATE_TOKEN:'DUPLICATE_TOKEN',TWO_SLOTS_FULL:'TWO_SLOTS_FULL',DAILY_LIMIT:'DAILY_LIMIT'
};
export function interpretEchoPilotReservationReply(
 data:unknown,error:unknown, executionWallet:string,mint:string
):AtomicReservationResult {
 if(error || typeof data!=='string')return {reserved:false,reason:'DATABASE_UNAVAILABLE'};
 if(data==='RESERVED')return {reserved:true,key:executionWallet+':'+mint};
 return {reserved:false,reason:resultMap[data]??'DATABASE_UNAVAILABLE'};
}
export function createEchoAtomicSupabaseStore(client:SupabaseClient):EchoAtomicPositionStore {
 return {async reserveIfCapacity(lease){
  try {
   const {data,error}=await client.rpc('echo_pilot_reserve_atomic',{
    p_execution_wallet:lease.executionWallet,
    p_mint:lease.mint,p_caller_wallet:lease.callerWallet,
    p_source_signature:lease.signature,p_amount_lamports:lease.amountLamports
   });
   return interpretEchoPilotReservationReply(data,error,lease.executionWallet,lease.mint);
  }catch{return {reserved:false,reason:'DATABASE_UNAVAILABLE'};}
 }};
}
