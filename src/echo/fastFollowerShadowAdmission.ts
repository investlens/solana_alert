/**
 * Shadow-only low-latency BUY handoff.
 * Caller must already have independently verified signer-owned swap deltas.
 * The trusted quote is compared to caller price BEFORE atomic reservation.
 * Success means "reserved for shadow study", NEVER "sign or broadcast".
 */
import {screenEchoFastFollower,type EchoFastFollowerCandidate}
 from './fastFollowerPriceGate.js';
import {reserveEchoTenDollarPilot,type EchoAtomicPositionStore}
 from './atomicPilotReservation.js';
import {screenEchoTenDollarPilot,type PilotOrder}
 from './tenDollarPilot.js';

export const ECHO_FAST_FOLLOWER_EXECUTION_ENABLED=false as const;
export type EchoShadowAdmissionResult=
 | {ok:true;mode:'SHADOW_RESERVED_ONLY';reservationKey:string;
    amountLamports:number;priceMarkupBps:number;signingApproved:false}
 | {ok:false;reason:string;signingApproved:false};
const denied=(reason:string):EchoShadowAdmissionResult=>({ok:false,reason,signingApproved:false});
export async function reserveEchoFastFollowerShadow(input:{
 candidate:EchoFastFollowerCandidate;pilot:PilotOrder;executionWallet:string;
 store:EchoAtomicPositionStore;
}):Promise<EchoShadowAdmissionResult>{
 const fast=screenEchoFastFollower(input.candidate);
 if('reason' in fast)return denied(fast.reason);
 // No mismatch between independently verified signer-owned swap and pilot.
 if(input.candidate.callerMint!==input.pilot.mint||
    input.pilot.nowMs!==input.candidate.nowMs||
    !input.pilot.verifiedBuyerSigner||!input.pilot.originalSwapSucceeded||
    !input.pilot.verifiedSpend||!input.pilot.verifiedTokenCredit)
   return denied('CALLER_EVIDENCE_MISMATCH');
 const pilot=screenEchoTenDollarPilot(input.pilot);
 if('reason' in pilot)return denied(pilot.reason);
 if(String(pilot.amountLamports)!==input.candidate.ourInputLamports)
  return denied('QUOTE_AMOUNT_DIFFERS_FROM_TEN_DOLLAR_ORDER');
 // Only the atomic adapter may grant one lifetime wallet/mint reservation.
 const reserved=await reserveEchoTenDollarPilot(input.pilot,input.executionWallet,
  input.candidate.callerBuySignature,input.store);
 if('reason' in reserved)return denied(reserved.reason);
 return {ok:true,mode:'SHADOW_RESERVED_ONLY',reservationKey:reserved.key,
  amountLamports:pilot.amountLamports,priceMarkupBps:fast.priceMarkupBps,
  signingApproved:false};
}
