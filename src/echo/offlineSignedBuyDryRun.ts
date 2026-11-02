/** Echo isolated signer OFFLINE BUY signature test.
 * This runs only within the trusted isolated signing process.
 * No signed bytes, message signature, private keys or transaction material
 * are returned to the coordinator or logged. Never posts to an RPC.
 *
 * IMPORTANT: Approval is PREVIEW_ONLY. A successful dry run is NOT approval
 * to execute, and does not replace independent route/CPI/economic audits.
 */
import {createHash,createPublicKey,verify as verifyEd25519} from 'node:crypto';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {echoReadOnlySignerAdmission} from './readOnlySignerAdmission.js';
import type {EchoAuthenticatedExecutionRequest,EchoNonceStore} from './authenticatedSignerRequest.js';
import type {EchoTrustedReservationReader} from './trustedReservationPreview.js';
import type {EchoJupiterV2PreviewResult} from './readOnlyJupiterV2Swap.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';

export const ECHO_SIGNED_BUY_DRY_RUN_BROADCAST_ENABLED=false as const;
export const ECHO_SIGNED_BUY_DRY_RUN_AUTHORISES_LIVE_BUY=false as const;
export interface EchoOfflineSigningBoundary{
  publicWallet:string;
  /** Signs the exact serialized v0 transaction MESSAGE, never for a caller. */
  signTransactionMessageForDryRun(message:Uint8Array):Promise<Uint8Array>;
}
export type EchoOfflineSignedBuyResult=
 | {ok:true;mode:'SIGNED_LOCALLY_DISCARDED';messageSha256:string;
    signerVerified:true;signatureDiscarded:true;broadcastAllowed:false}
 | {ok:false;reason:string;broadcastAllowed:false};

function cryptoVerify(message:Uint8Array,signature:Uint8Array,wallet:string){
 try{
  if(signature.length!==64)return false;
  const publicKey=new PublicKey(wallet);
  const der=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey.toBytes())]);
  return verifyEd25519(null,Buffer.from(message),
   createPublicKey({key:der,format:'der',type:'spki'}),Buffer.from(signature));
 }catch{return false;}
}

/** Test seam: the real-wallet gate below must be used in production. */
export async function verifySignedBuyDryRunInBoundary(args:{
 wallet:string; signer:EchoOfflineSigningBoundary;message:Uint8Array;
}):Promise<EchoOfflineSignedBuyResult>{
 const stop=(reason:string):EchoOfflineSignedBuyResult=>({ok:false,reason,broadcastAllowed:false});
 if(!args.wallet||args.signer.publicWallet!==args.wallet||args.message.length<20||args.message.length>2000)
  return stop('SIGNER_IDENTITY_OR_MESSAGE_INVALID');
 let signature:Uint8Array;
 try{signature=await args.signer.signTransactionMessageForDryRun(args.message);}
 catch{return stop('SIGNER_UNAVAILABLE');}
 // The bytes are intentionally not exported. Best-effort wipe local copies;
 // secure signer backends must also ensure temporary signing objects are scrubbed.
 const verified=cryptoVerify(args.message,signature,args.wallet);
 try{signature.fill(0);}catch{}
 if(!verified)return stop('SIGNATURE_MISMATCH');
 return {ok:true,mode:'SIGNED_LOCALLY_DISCARDED',
  messageSha256:createHash('sha256').update(args.message).digest('hex'),
  signerVerified:true,signatureDiscarded:true,broadcastAllowed:false};
}

/** Verified coordinator request + durable nonce + DB row + simulated exact
 * unsigned bytes are REQUIRED before the actual wallet is asked to sign.
 * Never called from Telegram, caller monitor or main AlphaOS service.
 */
export async function dryRunEchoActualWalletBuyNoBroadcast(args:{
 signer:EchoOfflineSigningBoundary;
 request:EchoAuthenticatedExecutionRequest;coordinatorSignatureBase58:string;
 coordinatorPublicKey:string;nowMs:number;unsignedTransactionBytes:Uint8Array;
 nonceStore:EchoNonceStore;reservationReader:EchoTrustedReservationReader;
 preview:EchoJupiterV2PreviewResult;
}):Promise<EchoOfflineSignedBuyResult>{
 const stop=(reason:string):EchoOfflineSignedBuyResult=>({ok:false,reason,broadcastAllowed:false});
 if(args.signer.publicWallet!==ECHO_EXPECTED_EXECUTION_WALLET||
    args.request.executionWallet!==ECHO_EXPECTED_EXECUTION_WALLET||
    args.request.action!=='BUY')return stop('PINNED_BUY_WALLET_REQUIRED');
 const admitted=await echoReadOnlySignerAdmission({
  request:args.request,coordinatorSignatureBase58:args.coordinatorSignatureBase58,
  coordinatorPublicKey:args.coordinatorPublicKey,nowMs:args.nowMs,
  unsignedTransactionBytes:args.unsignedTransactionBytes,
  nonceStore:args.nonceStore,reservationReader:args.reservationReader,
  preview:args.preview
 });
 if('reason' in admitted)return stop('BUY_ADMISSION_'+admitted.reason);
 let tx:VersionedTransaction;
 try{tx=VersionedTransaction.deserialize(args.unsignedTransactionBytes);}
 catch{return stop('UNREADABLE_UNSIGNED_TRANSACTION');}
 const message=tx.message.serialize();
 return verifySignedBuyDryRunInBoundary({wallet:ECHO_EXPECTED_EXECUTION_WALLET,
  signer:args.signer,message});
}
