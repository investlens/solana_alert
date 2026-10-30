/** Authenticated, replay-resistant request envelope for a future Echo signer.
 * The coordinator signs this canonical request with its own Ed25519 identity;
 * the signer MUST trust only a pinned coordinator PUBLIC key, and atomically
 * consume nonce in durable storage before acting. No wallet secrets here.
 */
import {createHash,createPublicKey,verify as ed25519Verify} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_AUTH_CONTEXT='AlphaOS-Echo/signer-request/v1';
export type EchoAuthenticatedExecutionRequest={
  audience:'echo-isolated-signer'; action:'BUY'|'SELL';
  executionWallet:string;mint:string;reservationKey:string;
  transactionSha256:string;nonceHex:string;issuedAtMs:number;expiresAtMs:number;
};
export interface EchoNonceStore {
  /** Atomic insert-if-absent; durable across restarts and workers. */
  consumeOnce(nonceHex:string, expiresAtMs:number):Promise<boolean>;
}
export type EchoSignerAuthResult={ok:true}|{ok:false;reason:string};
const hex=/^[0-9a-f]{64}$/;
export function echoSignerCanonicalRequest(v:EchoAuthenticatedExecutionRequest):string{
 return [ECHO_AUTH_CONTEXT,v.audience,v.action,v.executionWallet,v.mint,v.reservationKey,
  v.transactionSha256,v.nonceHex,String(v.issuedAtMs),String(v.expiresAtMs)].join('\n');
}
export async function authenticateEchoSignerRequest(args:{
 request:EchoAuthenticatedExecutionRequest; signatureBase58:string;
 authorizedCoordinatorPublicKey:string; nowMs:number;
 unsignedTransactionBytes:Uint8Array; nonceStore:EchoNonceStore;
}):Promise<EchoSignerAuthResult>{
 const {request:r,nowMs}=args;
 if(r.audience!=='echo-isolated-signer'||!['BUY','SELL'].includes(r.action)||
    r.executionWallet!==ECHO_EXPECTED_EXECUTION_WALLET||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.mint)||
    r.reservationKey!==r.executionWallet+':'+r.mint||
    !hex.test(r.nonceHex)||!hex.test(r.transactionSha256)||
    !Number.isSafeInteger(nowMs)||!Number.isSafeInteger(r.issuedAtMs)||
    !Number.isSafeInteger(r.expiresAtMs)||r.issuedAtMs>nowMs||
    r.expiresAtMs<nowMs||r.expiresAtMs<=r.issuedAtMs||
    r.expiresAtMs-r.issuedAtMs>30000)
   return {ok:false,reason:'INVALID_OR_EXPIRED_REQUEST'};
 if(args.unsignedTransactionBytes.length<80||args.unsignedTransactionBytes.length>3072||
   createHash('sha256').update(args.unsignedTransactionBytes).digest('hex')!==r.transactionSha256)
   return {ok:false,reason:'TRANSACTION_HASH_MISMATCH'};
 try{
  const sig=bs58.decode(args.signatureBase58);
  if(sig.length!==64)return {ok:false,reason:'INVALID_COORDINATOR_SIGNATURE'};
  const coordinator=new PublicKey(args.authorizedCoordinatorPublicKey);
  if(coordinator.toBase58()===r.executionWallet)
   return {ok:false,reason:'COORDINATOR_MUST_BE_DISTINCT'};
  const der=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(coordinator.toBytes())]);
  if(!ed25519Verify(null,Buffer.from(echoSignerCanonicalRequest(r),'utf8'),
     createPublicKey({key:der,format:'der',type:'spki'}),sig))
   return {ok:false,reason:'INVALID_COORDINATOR_SIGNATURE'};
 }catch{return {ok:false,reason:'INVALID_COORDINATOR_SIGNATURE'};}
 try{
  if(!await args.nonceStore.consumeOnce(r.nonceHex,r.expiresAtMs))
   return {ok:false,reason:'REPLAYED_REQUEST'};
 }catch{return {ok:false,reason:'NONCE_STORAGE_UNAVAILABLE'};}
 return {ok:true};
}
/** Even authenticated requests are NOT sufficient for signing.
 * Signer must independently fetch DB reservation, audit transaction economics,
 * simulation, balance/fees, and full route; these remain unimplemented.
 */
export const ECHO_AUTHENTICATED_SIGNING_ENABLED=false as const;
