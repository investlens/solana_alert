/** Fail-closed connection between Echo's per-call BUY reservation and the
 * independent PumpSwap signer review. This is a NO-BROADCAST adapter seam,
 * not a production RPC provider, live signer service or transaction sender.
 * It accepts only an independently validated caller/quote and exact unsigned
 * message, then delegates to the real signer reviewer after DB reservation.
 */
import {createHash} from 'node:crypto';
import {prepareEchoPerCallNoBroadcast,
 type EchoPerCallTrustedSource,type EchoPerCallAtomicStore,
 type EchoPerCallPipelineResult} from './perCallNoBroadcastCoordinator.js';
import {screenEchoFiveDollarCall} from './fiveDollarCallPolicy.js';
import {perCallKey,type EchoPerCallSignerRequest,
 type EchoPerCallReservationReader} from './perCallSignerAdmissionV2.js';
import {reviewEchoPumpPerCallSignerNoBroadcast,
 type EchoTrustedPumpEvidenceReader,
 type EchoPumpSignerReviewResult} from './pumpPerCallSignerReview.js';
import type {EchoNonceStore} from './authenticatedSignerRequest.js';
export const ECHO_PUMP_NO_BROADCAST_BRIDGE_CAN_SIGN=false as const;
export const ECHO_PUMP_NO_BROADCAST_BRIDGE_CAN_BROADCAST=false as const;

export type EchoPumpBridgeInput={
 source:EchoPerCallTrustedSource;
 store:EchoPerCallAtomicStore;
 now:()=>number;
 /** Must be an independent, durable owner switch. OFF prevents all reads. */
 manualAutoBuyEnabled:boolean;
 /** Read the durable owner toggle again after asynchronous provider work.
  * A stale ON snapshot cannot override sleep OFF or the emergency switch.
  */
 ownerAutoBuyStillEnabled:()=>Promise<boolean>;
 /** The exact unsigned Pump SDK-produced bytes, never a Telegram payload. */
 unsignedTransactionBytes:Uint8Array;
 signerRequest:EchoPerCallSignerRequest;
 coordinatorSignatureBase58:string;
 pinnedCoordinatorPublicKey:string;
 nonceStore:EchoNonceStore;
 reservationReader:EchoPerCallReservationReader;
 evidenceReader:EchoTrustedPumpEvidenceReader;
};
export type EchoPumpBridgeResult={
 status:'BLOCKED'|'REVIEWED_NO_BROADCAST';
 reason:string;
 reservation:EchoPerCallPipelineResult|null;
 signer:EchoPumpSignerReviewResult|null;
 canSign:false;canBroadcast:false;canDeploy:false;
};
const blocked=(reason:string,reservation:EchoPerCallPipelineResult|null=null,
 signer:EchoPumpSignerReviewResult|null=null):EchoPumpBridgeResult=>
 ({status:'BLOCKED',reason,reservation,signer,
  canSign:false,canBroadcast:false,canDeploy:false});

export async function prepareEchoPumpNoBroadcastBridge(
 x:EchoPumpBridgeInput):Promise<EchoPumpBridgeResult>{
 if(!x.manualAutoBuyEnabled)return blocked('OWNER_AUTO_BUY_OFF');
 // Fail before any provider or DB access on impossible request shapes.
 const r=x.signerRequest;
 if(!r||r.action!=='BUY'||r.audience!=='echo-isolated-signer'||
    !Number.isSafeInteger(x.now())||
    x.unsignedTransactionBytes.length<80||
    x.unsignedTransactionBytes.length>3072||
    !/^[0-9a-f]{64}$/.test(r.transactionSha256)||
    createHash('sha256').update(x.unsignedTransactionBytes).digest('hex')!==r.transactionSha256||
    r.reservationKey!==perCallKey(r))
  return blocked('UNTRUSTED_UNSIGNED_MESSAGE_OR_SIGNER_REQUEST');
 // Reuse exact same independently observed bundle for both preflight and DB.
 // This protects against cross-call swapping between source and signer.
 let observation:Awaited<ReturnType<EchoPerCallTrustedSource['getVerifiedBuyAndQuote']>>;
 try{observation=await x.source.getVerifiedBuyAndQuote();}
 catch{return blocked('TRUSTED_CALLER_AND_QUOTE_UNAVAILABLE');}
 const c=observation.call;
 if(!c||c.executionWallet!==r.executionWallet||c.callerWallet!==r.callerWallet||
    c.sourceSignature!==r.sourceSignature||c.mint!==r.mint||
    perCallKey(c)!==r.reservationKey)
  return blocked('CALLER_SOURCE_SIGNER_IDENTITY_MISMATCH');
 let currentSwitch=false;
 try{currentSwitch=await x.ownerAutoBuyStillEnabled();}
 catch{return blocked('OWNER_SWITCH_UNAVAILABLE');}
 if(!currentSwitch)return blocked('OWNER_AUTO_BUY_OFF_DURING_QUOTE');
 const preflight=screenEchoFiveDollarCall({...c,nowMs:x.now()});
 if(!preflight.eligible)return blocked('PER_CALL_POLICY_'+preflight.reason);
 // Adapter returns the previously captured trusted bundle, never refetches
 // a potentially different caller between screening and DB reservation.
 const reservation=await prepareEchoPerCallNoBroadcast({
  source:{getVerifiedBuyAndQuote:async()=>observation},
  store:x.store,now:x.now,manualAutoBuyEnabled:x.manualAutoBuyEnabled
 });
 if(!reservation.reserved)return blocked(reservation.reason,reservation);
 // The reservation stays held if the owner disables trading here; never
 // release and blindly retry an unresolved source transaction.
 try{currentSwitch=await x.ownerAutoBuyStillEnabled();}
 catch{return blocked('OWNER_SWITCH_UNAVAILABLE_AFTER_RESERVATION',reservation);}
 if(!currentSwitch)return blocked('OWNER_AUTO_BUY_OFF_AFTER_RESERVATION',reservation);
 // A successful reservation is durable; if signer review fails it must remain
 // held for explicit reconciliation. NEVER implicitly release and retry.
 const signer=await reviewEchoPumpPerCallSignerNoBroadcast({
  request:r,coordinatorSignatureBase58:x.coordinatorSignatureBase58,
  pinnedCoordinatorPublicKey:x.pinnedCoordinatorPublicKey,
  nowMs:x.now(),unsignedTransactionBytes:x.unsignedTransactionBytes,
  nonceStore:x.nonceStore,reservationReader:x.reservationReader,
  evidenceReader:x.evidenceReader
 }).catch(()=>null);
 if(!signer)return blocked('ISOLATED_SIGNER_REVIEW_UNAVAILABLE',reservation);
 if(!signer.ok)return blocked('ISOLATED_SIGNER_'+signer.reason,reservation,signer);
 if(signer.reservationKey!==r.reservationKey||
    signer.unsignedSha256!==r.transactionSha256)
  return blocked('ISOLATED_SIGNER_FINGERPRINT_MISMATCH',reservation,signer);
 return {status:'REVIEWED_NO_BROADCAST',
  reason:'EXACT_CALL_AND_UNSIGNED_MESSAGE_REVIEWED_NO_EXECUTION',
  reservation,signer,canSign:false,canBroadcast:false,canDeploy:false};
}
