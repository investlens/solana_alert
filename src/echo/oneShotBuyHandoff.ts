/** Single-broadcast safety handoff. This adapter never transmits bytes.
 *
 * A successful handoff persists SUBMISSION_UNKNOWN with the original signed
 * transaction signature BEFORE any caller may attempt the one and only RPC
 * send. Unknown is intentionally sticky across process restarts.
 *
 * Only a separate audited executor may use this evidence for a one-shot send.
 * Do not treat it as permission to sign, retry or unlock a reservation.
 */
import {createHash} from 'node:crypto';
import {VersionedTransaction} from '@solana/web3.js';
import type {EchoTradeStateJournal} from './tradeStateJournal.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';
import {verifyEchoSignedMessage} from './signedMessageAttestation.js';
export const ECHO_ONE_SHOT_HANDOFF_BROADCAST_ENABLED=false as const;
export type EchoHandoffResult=
 | {ok:true;mode:'PERSISTED_NO_BROADCAST';signature:string;fingerprint:string;broadcastAllowed:false}
 | {ok:false;reason:string;broadcastAllowed:false};
export async function prepareEchoOneShotBuyHandoff(args:{
 journal:EchoTradeStateJournal;reservationKey:string;
 signedTransactionBase64:string;approvedMessageSha256:string;
 executionWallet:string;expectedMint:string;
 /** Must come from trusted database row, not the caller update. */
 dbReservedAndPending:boolean;
}):Promise<EchoHandoffResult>{
 const deny=(reason:string):EchoHandoffResult=>({ok:false,reason,broadcastAllowed:false});
 if(!args.dbReservedAndPending||!verifyEchoExecutionWallet(args.executionWallet)||
    args.reservationKey!==args.executionWallet+':'+args.expectedMint)
  return deny('DURABLE_RESERVATION_OR_WALLET_INVALID');
 const existing=args.journal.get(args.reservationKey);
 if(!existing||existing.state!=='SIMULATED')return deny('INTENT_NOT_IN_SIMULATED_STATE_OR_ALREADY_USED');
 const evidence=verifyEchoSignedMessage({
  signedTransactionBase64:args.signedTransactionBase64,
  approvedMessageSha256:args.approvedMessageSha256,
  expectedFeePayer:args.executionWallet
 });
 if('reason' in evidence)return deny('SIGNED_MESSAGE_'+evidence.reason);
 let bytes:Buffer;
 try{
  bytes=Buffer.from(args.signedTransactionBase64,'base64');
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0||tx.message.addressTableLookups.length!==0)
   return deny('SIGNED_TRANSACTION_ROUTE_NOT_SUPPORTED');
 }catch{return deny('INVALID_SIGNED_TRANSACTION');}
 const fingerprint=createHash('sha256').update(bytes).digest('hex');
 // Record signature before sending; any persistence error is a hard stop.
 // Even if an external worker crashes after this transition, it must
 // reconcile the SAME signature, not rebuild and rebroadcast a new BUY.
 try{
  const advanced=await args.journal.advance(args.reservationKey,{
   kind:'SUBMISSION_RESULT_UNKNOWN',fingerprint,signature:evidence.signature
  });
  if(!advanced.ok)return deny('DURABLE_HANDOFF_NOT_PERSISTED');
 }catch{return deny('DURABLE_HANDOFF_STORAGE_UNAVAILABLE');}
 return {ok:true,mode:'PERSISTED_NO_BROADCAST',signature:evidence.signature,
  fingerprint,broadcastAllowed:false};
}
