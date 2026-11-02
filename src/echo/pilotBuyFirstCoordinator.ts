/** Staged BUY-FIRST coordinator. Does not require pre-existing SELL tokens.
 * An owner will manually exit through their own wallet app; Telegram SELL is
 * deferred. Each privilege boundary is injected and must be implemented by
 * the trusted isolated service, not the caller/Telegram update.
 *
 * This module only validates a BUY, reserves it atomically, and durably
 * journals the plan; it cannot sign, broadcast or unlock a slot.
 */
import {previewEchoBuyFirst,type EchoBuyFirstInput}
 from './pilotBuyFirstPreview.js';
import type {EchoAllInPilotStore,AllInVerifiedSnapshot}
 from './allInPilotReservation.js';
import type {EchoTradeStateJournal} from './tradeStateJournal.js';
import type {EchoJupiterV2PreviewRequest,EchoJupiterV2PreviewResult}
 from './readOnlyJupiterV2Swap.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';

export const ECHO_BUY_FIRST_COORDINATOR_LIVE_ENABLED=false as const;
type TrustedPlan={
 plan:EchoBuyFirstInput;callerSignature:string;proof:AllInVerifiedSnapshot;
};
export interface EchoBuyFirstTrustedProvider{
 getVerifiedPlan():Promise<TrustedPlan>;
}
export type EchoBuyFirstCoordinatorResult={
 prepared:boolean;executable:false;reason:string;reservationKey?:string;
 buySimulationPassed:boolean;
};
type Preview=(x:EchoJupiterV2PreviewRequest)=>Promise<EchoJupiterV2PreviewResult>;
export async function prepareEchoBuyFirstCoordinator(args:{
 provider:EchoBuyFirstTrustedProvider;store:EchoAllInPilotStore;
 journal:EchoTradeStateJournal;preview?:Preview;
}):Promise<EchoBuyFirstCoordinatorResult>{
 const deny=(reason:string,buySimulationPassed=false):EchoBuyFirstCoordinatorResult=>({
  prepared:false,executable:false,reason,buySimulationPassed
 });
 let verified:TrustedPlan;
 try{verified=await args.provider.getVerifiedPlan();}
 catch{return deny('TRUSTED_PLAN_UNAVAILABLE');}
 const {plan,callerSignature,proof}=verified;
 if(!plan||!verifyEchoExecutionWallet(plan.executionWallet)||
    !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(callerSignature))
  return deny('DEDICATED_WALLET_OR_CALLER_PROOF_MISSING');
 const preview=await previewEchoBuyFirst(plan,args.preview).catch(()=>null);
 if(!preview?.eligible)return deny(preview?.reason??'BUY_PREVIEW_UNAVAILABLE');
 // Reserve using only the verified BUY fields. No fabricated SELL approval.
 let result:Awaited<ReturnType<EchoAllInPilotStore['reserveAllIn']>>;
 try{result=await args.store.reserveAllIn({plan,callerSignature,proof});}
 catch{return deny('ATOMIC_DATABASE_UNAVAILABLE',true);}
 if('reason' in result)return deny('ATOMIC_'+result.reason,true);
 // The reservation is intentionally irreversible for this mint. If the
 // process crashes here, the DB reservation survives; never buy twice.
 try{
  if(!await args.journal.reserve(result.key))
   return deny('JOURNAL_ALREADY_RESERVED',true);
  const timestamp=Date.now();
  const first=await args.journal.advance(result.key,{kind:'QUOTE_OK',nowMs:timestamp});
  if(!first.ok)return deny('JOURNAL_QUOTE_FAILURE',true);
  const second=await args.journal.advance(result.key,{kind:'SIMULATION_OK',nowMs:timestamp});
  if(!second.ok)return deny('JOURNAL_SIMULATION_FAILURE',true);
  return {prepared:true,executable:false,reason:'BUY_PREPARED_NO_SIGNING',
   reservationKey:result.key,buySimulationPassed:true};
 }catch{return deny('JOURNAL_STORAGE_UNAVAILABLE_DB_RESERVATION_HELD',true);}
}
