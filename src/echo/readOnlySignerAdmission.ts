/** End-to-end read-only signer admission: coordinator identity + durable nonce
 * + exact unsigned bytes + trusted DB reservation + simulation receipt.
 * This does NOT hold a trading private key, sign or broadcast transactions.
 */
import {authenticateEchoSignerRequest,type EchoAuthenticatedExecutionRequest,
 type EchoNonceStore} from './authenticatedSignerRequest.js';
import {verifyEchoPreviewAgainstLedger,type EchoTrustedReservationReader} from './trustedReservationPreview.js';
import type {EchoJupiterV2PreviewResult} from './readOnlyJupiterV2Swap.js';
import {auditEchoUnsignedSwap} from './unsignedSwapAudit.js';
export const ECHO_SIGNER_READ_ONLY_GATE=true as const;
export const ECHO_SIGNER_TRANSACTION_APPROVAL_ENABLED=false as const;
export async function echoReadOnlySignerAdmission(args:{
 request:EchoAuthenticatedExecutionRequest;coordinatorSignatureBase58:string;
 coordinatorPublicKey:string;nowMs:number;unsignedTransactionBytes:Uint8Array;
 nonceStore:EchoNonceStore;reservationReader:EchoTrustedReservationReader;
 preview:EchoJupiterV2PreviewResult;
}):Promise<
 {ok:true;mode:'PREVIEW_ONLY_NO_SIGNING';fingerprint:string}
 |{ok:false;reason:string}
>{
 if(!args.preview.ok)return {ok:false,reason:'RPC_SIMULATION_NOT_VERIFIED'};
 if(args.preview.unsignedTransactionSha256!==args.request.transactionSha256)
  return {ok:false,reason:'SIGNED_REQUEST_PREVIEW_HASH_MISMATCH'};
 // Never trust caller-controlled preview flags or a hash alone: re-parse the
 // exact unsigned bytes locally before consuming a one-time coordinator nonce.
 const checked=auditEchoUnsignedSwap(
   Buffer.from(args.unsignedTransactionBytes).toString('base64'),
   args.request.executionWallet
 );
 if('reason' in checked)return {ok:false,reason:'UNSIGNED_AUDIT_'+checked.reason};
 if(checked.audit.sha256!==args.request.transactionSha256)
   return {ok:false,reason:'UNSIGNED_AUDIT_HASH_MISMATCH'};
 if(!checked.audit.feeEstimateComplete)
   return {ok:false,reason:'PRIORITY_FEE_EVIDENCE_INCOMPLETE'};
 if(args.preview.unsignedAudit &&
    args.preview.unsignedAudit.sha256!==checked.audit.sha256)
   return {ok:false,reason:'UNSIGNED_AUDIT_PREVIEW_MISMATCH'};
 const authorized=await authenticateEchoSignerRequest({
  request:args.request,signatureBase58:args.coordinatorSignatureBase58,
  authorizedCoordinatorPublicKey:args.coordinatorPublicKey,nowMs:args.nowMs,
  unsignedTransactionBytes:args.unsignedTransactionBytes,nonceStore:args.nonceStore
 });
 if('reason' in authorized)return {ok:false,reason:authorized.reason};
 const admission=await verifyEchoPreviewAgainstLedger({
  side:args.request.action,wallet:args.request.executionWallet,
  mint:args.request.mint,preview:args.preview,reader:args.reservationReader
 });
 if('reason' in admission)return {ok:false,reason:admission.reason};
 return {ok:true,mode:'PREVIEW_ONLY_NO_SIGNING',fingerprint:admission.transactionSha256};
}
