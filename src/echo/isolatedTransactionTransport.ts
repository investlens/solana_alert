/** Echo isolated transaction transport. Only call from a dedicated, authenticated
 * execution worker after independent unsigned-message and reservation verification.
 * Does not hold a wallet secret or sign. Strict hard-off in this build.
 */
import { VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
export const ECHO_LIVE_SUBMISSION_COMPILED_ENABLED=false as const;
export type EchoRpcOutcome =
 | {kind:'SUBMITTED';signature:string}
 | {kind:'REJECTED';reason:string}
 | {kind:'UNKNOWN';reason:string};
export type EchoChainStatus =
 | {kind:'CONFIRMED'}
 | {kind:'FAILED';reason:string}
 | {kind:'PENDING'}
 | {kind:'UNKNOWN'};
const signatureFormat=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const validRpc=(rpcUrl:string)=>{
 try{const u=new URL(rpcUrl);return u.protocol==='https:'&&!u.username&&!u.password&&
   !u.hash&&!u.search;}catch{return false;}
};
export function readSignedEchoTransaction(base64:string,expectedWallet:string):
 {ok:true;bytes:Uint8Array;signature:string}|{ok:false;reason:string}{
 if(typeof base64!=='string'||base64.length<120||base64.length>4096||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
  return {ok:false,reason:'INVALID_SIGNED_BYTES'};
 try{
  const bytes=Buffer.from(base64,'base64');
  if(bytes.toString('base64')!==base64)return {ok:false,reason:'INVALID_SIGNED_BYTES'};
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
     tx.message.staticAccountKeys[0]?.toBase58()!==expectedWallet||
     tx.message.header.numRequiredSignatures!==1||tx.signatures.length!==1||
     tx.signatures[0].every(x=>x===0))return {ok:false,reason:'UNTRUSTED_SIGNED_TRANSACTION'};
  const signature=bs58.encode(tx.signatures[0]);
  if(!signatureFormat.test(signature))return {ok:false,reason:'INVALID_SIGNATURE'};
  return {ok:true,bytes,signature};
 }catch{return {ok:false,reason:'INVALID_SIGNED_BYTES'};}
}
export async function submitEchoSignedTransaction(args:{
 rpcUrl:string;signedBase64:string;expectedWallet:string;
 killSwitchEngaged:boolean; ownerApprovedLiveExecution:boolean;
},post:typeof fetch=fetch):Promise<EchoRpcOutcome>{
 // Compiled hard-off: no credentials or runtime flags can bypass this.
 if(!ECHO_LIVE_SUBMISSION_COMPILED_ENABLED||!args.ownerApprovedLiveExecution||
    args.killSwitchEngaged)return {kind:'REJECTED',reason:'LIVE_SUBMISSION_DISABLED'};
 if(!validRpc(args.rpcUrl))return {kind:'REJECTED',reason:'INVALID_RPC_URL'};
 const decoded=readSignedEchoTransaction(args.signedBase64,args.expectedWallet);
 if(!decoded.ok)return {kind:'REJECTED',reason:decoded.reason};
 try{
  const response=await post(args.rpcUrl,{
   method:'POST',headers:{'content-type':'application/json'},
   signal:AbortSignal.timeout(4000),
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'sendRawTransaction',
    params:[args.signedBase64,{encoding:'base64',skipPreflight:false,maxRetries:0,preflightCommitment:'processed'}]})
  });
  // An RPC error does not prove there was no broadcast; never blindly retry.
  if(!response.ok)return {kind:'UNKNOWN',reason:'RPC_BROADCAST_OUTCOME_UNKNOWN'};
  const json=await response.json();
  if(json?.result===decoded.signature)return {kind:'SUBMITTED',signature:decoded.signature};
  return {kind:'UNKNOWN',reason:'RPC_RESPONSE_NOT_VERIFIED'};
 }catch{return {kind:'UNKNOWN',reason:'RPC_BROADCAST_OUTCOME_UNKNOWN'};}
}
export async function inspectEchoTransactionConfirmation(args:{
 rpcUrl:string;signature:string;
},post:typeof fetch=fetch):Promise<EchoChainStatus>{
 if(!validRpc(args.rpcUrl)||!signatureFormat.test(args.signature))return {kind:'UNKNOWN'};
 try{
  const response=await post(args.rpcUrl,{
   method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(4000),
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSignatureStatuses',
    params:[[args.signature],{searchTransactionHistory:true}]})
  });
  if(!response.ok)return {kind:'UNKNOWN'};
  const json=await response.json();
  if(json.error||!Array.isArray(json.result?.value)||json.result.value.length!==1)
   return {kind:'UNKNOWN'};
  const s=json.result.value[0];
  if(!s)return {kind:'PENDING'};
  if(s.err)return {kind:'FAILED',reason:'CHAIN_TRANSACTION_ERROR'};
  if(s.confirmationStatus==='confirmed'||s.confirmationStatus==='finalized')
   return {kind:'CONFIRMED'};
  return {kind:'PENDING'};
 }catch{return {kind:'UNKNOWN'};}
}
