/**
 * Read-only transaction evidence observation. A trusted caller must establish
 * endpoint authenticity; this adapter never signs, broadcasts or sets DB flags.
 */
import type { RpcTransport } from './adminSolanaRpcObserver.js';
import { verifyEchoCallerBuyEvidence } from './adminCallerEvidence.js';
export type CallerObservation=Readonly<{
 verified:boolean;reason:string;signature:string;callerWallet:string;mint:string
}>;
export async function observeEchoCallerBuy(
 transport:RpcTransport,
 input:Readonly<{signature:string;callerWallet:string;mint:string;
  rpcTrusted:boolean;historyCaughtUp:boolean;ageSeconds:number}>,
):Promise<CallerObservation>{
 const deny=(reason:string):CallerObservation=>({verified:false,reason,
  signature:input.signature,callerWallet:input.callerWallet,mint:input.mint});
 if(!input.rpcTrusted||!input.historyCaughtUp)return deny('UNTRUSTED_RPC');
 if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(input.signature))return deny('INVALID_SIGNATURE');
 try{
  const raw=await transport('getTransaction',[input.signature,
   {encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if(!raw||typeof raw!=='object')return deny('INVALID_RPC_RESPONSE');
  const result=(raw as {result?:unknown}).result;
  if(!result||typeof result!=='object')return deny('MISSING_FINALIZED_TRANSACTION');
  const tx=result as {meta?:{err?:unknown};transaction?:{
   signatures?:unknown;message?:{accountKeys?:unknown;instructions?:unknown}}};
  if(!tx.meta||tx.meta.err!==null||!tx.transaction||
   !Array.isArray(tx.transaction.signatures)||
   tx.transaction.signatures[0]!==input.signature)return deny('UNVERIFIED_TRANSACTION');
  // JSON-RPC getTransaction can return a processed result even when the
  // caller requested finalized; require an independent finalized status.
  const statusRaw=await transport('getSignatureStatuses',[[input.signature],{searchTransactionHistory:true}]);
  const status=(statusRaw as {result?:{value?:unknown}}|null)?.result?.value;
  const entry=Array.isArray(status)?status[0]:null;
  if(!entry||typeof entry!=='object'||
     (entry as {confirmationStatus?:unknown}).confirmationStatus!=='finalized'||
     (entry as {err?:unknown}).err!==null)return deny('NOT_FINALIZED_OR_FAILED');
  const keys=tx.transaction.message?.accountKeys;
  if(!Array.isArray(keys))return deny('MISSING_SIGNER_EVIDENCE');
  const signer=keys.some((k:unknown)=>k!==null&&typeof k==='object'&&
   (k as {pubkey?:unknown;signer?:unknown}).pubkey===input.callerWallet&&
   (k as {signer?:unknown}).signer===true);
  // A parsed instruction or token balance delta alone cannot prove a swap BUY.
  // An independently reviewed DEX parser is required before enabling this.
  const verdict=verifyEchoCallerBuyEvidence({
   callerWallet:input.callerWallet,transactionSignature:input.signature,
   tokenMint:input.mint,verifiedSigner:signer,verifiedSwapBuy:false,
   finalized:true,rpcTrusted:input.rpcTrusted,
   transactionAgeSeconds:input.ageSeconds,tokenTransferOnly:false,
  });
  return deny(verdict.reason);
 }catch{return deny('RPC_REQUEST_FAILED');}
}
