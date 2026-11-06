/** Supabase adapter for new fee-inclusive wallet-wide SQL reservation.
 * Zero signing/broadcast. Migration must be reviewed/applied separately.
 * DB SERIALIZATION is the authority; coordinator snapshots alone never are.
 */
import type {SupabaseClient} from '@supabase/supabase-js';
import type {PilotReadOnlyPlan} from './pilotRoundTripPreview.js';
import {screenEchoTenDollarPilot} from './tenDollarPilot.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';
export type AllInReservationResult=
 | {reserved:true;key:string}
 | {reserved:false;reason:string};
export type AllInVerifiedSnapshot={
 /** Obtained from privileged real-time chain and SOL/USD sources. */
 balanceVerifiedAtIso:string;
 /** Must match independently observed pinned wallet, balance and price. */
 wallet:string;spendableWalletCents:string;solUsdCents:number;contextSlot:number;
};
export type EchoBuyReservationPlan=Pick<PilotReadOnlyPlan,'order'|'budget'|'executionWallet'>;
export interface EchoAllInPilotStore {
 reserveAllIn(args:{
  plan:EchoBuyReservationPlan;callerSignature:string;proof:AllInVerifiedSnapshot;
 }):Promise<AllInReservationResult>;
}
const asSafeInt=(s:string|null):number|null=>{
 if(s===null||!/^(0|[1-9][0-9]{0,10})$/.test(s))return null;
 const n=Number(s);return Number.isSafeInteger(n)?n:null;
};
export function createEchoAllInSupabaseStore(client:SupabaseClient):EchoAllInPilotStore {
 return {async reserveAllIn({plan,callerSignature,proof}){
  try{
   if(!verifyEchoExecutionWallet(plan.executionWallet)||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(callerSignature))
    return {reserved:false,reason:'UNVERIFIED_SOURCE_OR_WALLET'};
   const principal=asSafeInt(plan.budget.newPrincipalCents);
   const priceCents=Number.isFinite(plan.order.priceSolUsd)?Math.round(plan.order.priceSolUsd*100):NaN;
   const buyCosts=asSafeInt(plan.budget.allInBuyCostsCents);
   const exitReserve=asSafeInt(plan.budget.exitAndNetworkReserveCents);
   const balance=asSafeInt(proof.spendableWalletCents);
   const at=Date.parse(proof.balanceVerifiedAtIso);
   if(principal===null||proof.wallet!==plan.executionWallet||
      proof.spendableWalletCents!==plan.budget.spendableWalletCents||
      !Number.isSafeInteger(proof.contextSlot)||proof.contextSlot<=0||
      priceCents!==proof.solUsdCents||
      !Number.isSafeInteger(priceCents)||priceCents<=0||
      buyCosts===null||exitReserve===null||balance===null||
      !Number.isFinite(at)||Math.abs(Date.now()-at)>3000)
    return {reserved:false,reason:'INVALID_OR_STALE_CAPITAL_PROOF'};
   const admitted=screenEchoTenDollarPilot(plan.order,principal);
   if('reason' in admitted)return {reserved:false,reason:admitted.reason};
   // The legacy SQL function would bypass all-in capital accounting. Never
   // allow an automatic fallback to echo_pilot_reserve_atomic.
   const {data,error}=await client.rpc('echo_pilot_reserve_all_in_atomic',{
    p_execution_wallet:plan.executionWallet,
    p_mint:plan.order.mint,
    p_caller_wallet:plan.order.callerWallet,
    p_source_signature:callerSignature,
    p_amount_lamports:admitted.amountLamports,
    p_principal_cents:principal,
    p_verified_sol_usd_cents:priceCents,
    p_buy_cost_ceiling_cents:buyCosts,
    p_exit_reserve_cents:exitReserve,
    p_verified_spendable_wallet_cents:balance,
    p_balance_verified_at:proof.balanceVerifiedAtIso
   });
   if(error||typeof data!=='string')return {reserved:false,reason:'DATABASE_UNAVAILABLE'};
   if(data==='RESERVED')return {reserved:true,key:plan.executionWallet+':'+plan.order.mint};
   return {reserved:false,reason:data.slice(0,90)};
  }catch{return {reserved:false,reason:'DATABASE_UNAVAILABLE'};}
 }};
}
