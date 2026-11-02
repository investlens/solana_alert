/** Single-shot BUY claim adapter, SERVER ONLY.
 * The privileged RPC serializes all workers and irrevocably records the
 * actual signed transaction signature + cryptographically approved digest.
 *
 * This adapter NEVER signs or broadcasts. It does not mark a transaction
 * confirmed; only independent chain reconciliation may do so.
 * REVIEW ONLY: SQL echo-pilot-one-shot-submission.sql not applied.
 */
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {verifyEchoSignedMessage} from './signedMessageAttestation.js';
export const ECHO_SUPABASE_ONE_SHOT_SUBMISSION_ENABLED=false as const;
export type EchoAtomicClaimResult=
 | {claimed:true;signature:string;fingerprint:string;broadcastAllowed:false}
 | {claimed:false;reason:string;broadcastAllowed:false};
const validMint=(value:string)=>{
 try{return new PublicKey(value).toBase58()===value}catch{return false}
};
export async function claimEchoSignedBuyOnce(args:{
 client:SupabaseClient;executionWallet:string;mint:string;
 signedTransactionBase64:string;approvedMessageSha256:string;
 lastValidBlockHeight:number;
}):Promise<EchoAtomicClaimResult>{
 const reject=(reason:string):EchoAtomicClaimResult=>({
  claimed:false,reason,broadcastAllowed:false});
 if(args.executionWallet!==ECHO_EXPECTED_EXECUTION_WALLET||
    !validMint(args.mint)||args.mint==='So11111111111111111111111111111111111111112')
  return reject('WALLET_OR_TOKEN_MISMATCH');
 if(!Number.isSafeInteger(args.lastValidBlockHeight)||
    args.lastValidBlockHeight<=0)
  return reject('INVALID_LAST_VALID_BLOCK_HEIGHT');
 const proof=verifyEchoSignedMessage({
  signedTransactionBase64:args.signedTransactionBase64,
  approvedMessageSha256:args.approvedMessageSha256,
  expectedFeePayer:args.executionWallet
 });
 if('reason' in proof)return reject('INVALID_SIGNER_PROOF_'+proof.reason);
 const fingerprint=createHash('sha256')
  .update(Buffer.from(args.signedTransactionBase64,'base64')).digest('hex');
 try{
  const {data,error}=await args.client.rpc('echo_pilot_claim_submission_once',{
   p_execution_wallet:args.executionWallet,p_mint:args.mint,
   p_signature:proof.signature,
   p_approved_message_sha256:proof.messageSha256,
   p_signed_fingerprint_sha256:fingerprint,
   p_last_valid_block_height:args.lastValidBlockHeight
  });
  if(error||typeof data!=='string')return reject('ATOMIC_SUBMISSION_DB_UNAVAILABLE');
  if(data!=='CLAIMED')return reject('ATOMIC_'+data.slice(0,90));
  return {claimed:true,signature:proof.signature,fingerprint,
   broadcastAllowed:false};
 }catch{return reject('ATOMIC_SUBMISSION_DB_UNAVAILABLE');}
}
