/** Echo fast-follower BUY pipeline: STRICTLY NO SIGNING, NO BROADCAST.
 *
 * A trusted infrastructure adapter must independently prove all event,
 * quote, wallet and fee fields. Never accept a Telegram message or event
 * boolean as sole authority. This bridge attaches timing to an atomic
 * per-source database reservation; actual execution is NOT wired here.
 */
import {screenEchoFiveDollarCall,type EchoFiveDollarCall} from './fiveDollarCallPolicy.js';
export const ECHO_PER_CALL_PIPELINE_CAN_SIGN=false as const;
export const ECHO_PER_CALL_PIPELINE_CAN_BROADCAST=false as const;
export type EchoPerCallTrustedInput={
 call:EchoFiveDollarCall;
 /** Milliseconds when the verified whale BUY actually landed/was observed. */
 chainAtMs:number;
 websocketObservedAtMs:number;
 verifiedAtMs:number;
};
export interface EchoPerCallTrustedSource{
 /** Only server-owned, validated chain receipt + route/cost/FX providers. */
 getVerifiedBuyAndQuote():Promise<EchoPerCallTrustedInput>;
}
export interface EchoPerCallAtomicStore{
 reserve(call:EchoFiveDollarCall):Promise<
  {reserved:true;key:string;executable:false}
  |{reserved:false;reason:string;executable:false}>;
}
export type EchoPerCallTiming={
 chainToObservedMs:number;
 observationToVerifiedMs:number;
 verifiedToReservedMs:number;
 chainToReservedMs:number;
 meetsThreeSecondTarget:boolean;
 /** Real signature and RPC submission stage remain unmeasured. */
 signedAtMs:null;submittedAtMs:null;
};
export type EchoPerCallPipelineResult={
 reserved:boolean;executable:false;broadcastAllowed:false;
 reason:string;timing?:EchoPerCallTiming;
};
export async function prepareEchoPerCallNoBroadcast(args:{
 source:EchoPerCallTrustedSource;
 store:EchoPerCallAtomicStore;
 now:()=>number;
 manualAutoBuyEnabled:boolean;
}):Promise<EchoPerCallPipelineResult>{
 const reject=(reason:string):EchoPerCallPipelineResult=>({
  reserved:false,executable:false,broadcastAllowed:false,reason});
 if(!args.manualAutoBuyEnabled)return reject('OWNER_AUTO_BUY_OFF');
 let trusted:EchoPerCallTrustedInput;
 try{trusted=await args.source.getVerifiedBuyAndQuote();}
 catch{return reject('TRUSTED_CHAIN_QUOTE_UNAVAILABLE');}
 const {call,chainAtMs,websocketObservedAtMs,verifiedAtMs}=trusted;
 const nowMs=args.now();
 if([chainAtMs,websocketObservedAtMs,verifiedAtMs,nowMs].some(
    n=>!Number.isSafeInteger(n)||n<=0
  )||chainAtMs>websocketObservedAtMs||websocketObservedAtMs>verifiedAtMs||
    verifiedAtMs>nowMs||nowMs<call.nowMs||
    nowMs-call.nowMs>3000)return reject('UNRELIABLE_OR_STALE_TIMESTAMPS');
 // Revalidate at the exact reservation handoff rather than trusting a
 // cached eligibility result. No extra independent $6 network balance poll.
 const screened=screenEchoFiveDollarCall({...call,nowMs});
 if(!screened.eligible)return reject(screened.reason);
 const returned=await args.store.reserve({...call,nowMs}).catch(()=>null);
 if(!returned)return reject('ATOMIC_RESERVATION_UNAVAILABLE');
 if(!returned.reserved)return reject(returned.reason);
 if(returned.key!==screened.intentKey)
  return reject('RESERVATION_IDENTITY_MISMATCH_HALT_AND_RECONCILE');
 const endMs=args.now();
 if(!Number.isSafeInteger(endMs)||endMs<nowMs)return reject('INVALID_RESERVATION_TIMESTAMP');
 const timing:EchoPerCallTiming={
  chainToObservedMs:websocketObservedAtMs-chainAtMs,
  observationToVerifiedMs:verifiedAtMs-websocketObservedAtMs,
  verifiedToReservedMs:endMs-verifiedAtMs,
  chainToReservedMs:endMs-chainAtMs,
  meetsThreeSecondTarget:endMs-chainAtMs<=3000,
  signedAtMs:null,submittedAtMs:null
 };
 return {reserved:true,executable:false,broadcastAllowed:false,
  reason:'PER_CALL_RESERVED_NO_SIGNING_OR_BROADCAST',timing};
}
