/** Isolated PumpSwap per-source signed-and-DISCARDED BUY test.
 * This never sends transaction bytes to an RPC or the coordinator, and
 * never promotes review-only evidence to a real trading authorization.
 *
 * The pinned REAL Echo wallet must be sealed inside the isolated service.
 * Synthetic test keys can only exercise the generic signature verifier,
 * never demonstrate real-wallet signability.
 */
import {VersionedTransaction} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {verifySignedBuyDryRunInBoundary,
 type EchoOfflineSigningBoundary,type EchoOfflineSignedBuyResult} from './offlineSignedBuyDryRun.js';
import {reviewEchoPumpPerCallSignerNoBroadcast,
 type EchoTrustedPumpEvidenceReader} from './pumpPerCallSignerReview.js';
import type {EchoPerCallSignerRequest,EchoPerCallReservationReader} from './perCallSignerAdmissionV2.js';
import type {EchoNonceStore} from './authenticatedSignerRequest.js';

export const ECHO_PUMP_DRY_RUN_CAN_BROADCAST=false as const;
export const ECHO_PUMP_DRY_RUN_CAN_LIVE_TRADE=false as const;

export async function dryRunEchoPumpActualWalletBuySignedDiscard(input:{
 signer:EchoOfflineSigningBoundary;
 request:EchoPerCallSignerRequest;
 coordinatorSignatureBase58:string;
 pinnedCoordinatorPublicKey:string;
 nowMs:number;
 unsignedTransactionBytes:Uint8Array;
 nonceStore:EchoNonceStore;
 reservationReader:EchoPerCallReservationReader;
 evidenceReader:EchoTrustedPumpEvidenceReader;
 /** Durable owner switch from the signer trust boundary, never caller input. */
 ownerAutoBuyEnabled:()=>Promise<boolean>;
}):Promise<EchoOfflineSignedBuyResult>{
 const stop=(reason:string):EchoOfflineSignedBuyResult=>({ok:false,reason,broadcastAllowed:false});
 if(input.signer.publicWallet!==ECHO_EXPECTED_EXECUTION_WALLET||
    input.request.executionWallet!==ECHO_EXPECTED_EXECUTION_WALLET)
   return stop('REAL_PINNED_ECHO_WALLET_NOT_PROVISIONED');
 // Verify durable sleep OFF before even asking for authenticated DB/RPC
 // evidence; signer review rechecks it again before nonce consumption.
 let enabled=false;
 try{enabled=await input.ownerAutoBuyEnabled();}
 catch{return stop('SIGNER_OWNER_SWITCH_UNAVAILABLE');}
 if(!enabled)return stop('SIGNER_OWNER_AUTO_BUY_OFF');
 const review=await reviewEchoPumpPerCallSignerNoBroadcast({
  request:input.request,
  coordinatorSignatureBase58:input.coordinatorSignatureBase58,
  pinnedCoordinatorPublicKey:input.pinnedCoordinatorPublicKey,
  nowMs:input.nowMs,
  unsignedTransactionBytes:input.unsignedTransactionBytes,
  nonceStore:input.nonceStore,
  reservationReader:input.reservationReader,
  evidenceReader:input.evidenceReader,
  ownerAutoBuyEnabled:input.ownerAutoBuyEnabled
 });
 if(!review.ok)return stop('PUMP_PER_CALL_REVIEW_REJECTED');
 let message:Uint8Array;
 try{
  // Review already verified the exact hash; deserialize a private copy
  // and send only its serialized message into isolated signature verification.
  const bytes=Uint8Array.from(input.unsignedTransactionBytes);
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.header.numRequiredSignatures!==1||
    tx.signatures.length!==1||!tx.signatures[0].every(v=>v===0))
   return stop('UNSIGNED_TRANSACTION_NOT_PRISTINE');
  message=tx.message.serialize();
  bytes.fill(0);
 }catch{return stop('UNREADABLE_PUMP_TRANSACTION');}
 return verifySignedBuyDryRunInBoundary({
  wallet:ECHO_EXPECTED_EXECUTION_WALLET,signer:input.signer,message
 });
}
