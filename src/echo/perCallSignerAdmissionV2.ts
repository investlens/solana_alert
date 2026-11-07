/** Per-call v2 isolated-signer PRE-ADMISSION, no signing, no broadcast.
 * Legacy signer v1 keys wallet:mint and therefore CANNOT safely serve a
 * repeat-mint strategy; never call v1 as a fallback.
 *
 * Authenticates an exactly pinned per-source lot, fresh simulated unsigned
 * swap, immutable DB row and durable nonce. Actual wallet spending and
 * independent CPI auditing remain separate release-blocking requirements.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {auditEchoUnsignedSwap} from './unsignedSwapAudit.js';
import type {EchoJupiterV2PreviewResult} from './readOnlyJupiterV2Swap.js';
import type {EchoNonceStore} from './authenticatedSignerRequest.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_PER_CALL_SIGNER_V2_SIGNING_ENABLED=false as const;
export const ECHO_PER_CALL_SIGNER_V2_BROADCAST_ENABLED=false as const;
export const ECHO_PER_CALL_SIGNER_DOMAIN='AlphaOS-Echo/per-call-signer/v2';
export type EchoPerCallSignerRequest={
 audience:'echo-isolated-signer';action:'BUY';
 executionWallet:string;callerWallet:string;mint:string;sourceSignature:string;
 reservationKey:string;transactionSha256:string;nonceHex:string;
 issuedAtMs:number;expiresAtMs:number;
};
export type EchoPerCallReservation={
 executionWallet:string;callerWallet:string;mint:string;sourceSignature:string;
 state:string;amountLamports:number|string;allInCents:number|string;positionClosedAt:string|null;
 /** PostgreSQL bigint fields generally arrive as decimal strings over JSON. */
 exactFeeLamports?:number|string;accountRentLamports?:number|string;
 cpiExtraLamports?:number|string;allInLamports?:number|string;
 sellReserveLamports?:number|string;
 transactionSignature:string|null;
};
export interface EchoPerCallReservationReader{
 getByCall(wallet:string,sourceSignature:string):Promise<EchoPerCallReservation|null>;
}
const exactRowNonnegativeInt=(v:string|number):bigint|null=>{
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>=0?BigInt(v):null;
 if(typeof v==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(v))return BigInt(v);
 return null;
};
export const perCallKey=(r:Pick<EchoPerCallSignerRequest,
 'executionWallet'|'callerWallet'|'sourceSignature'|'mint'>)=>
 [r.executionWallet,r.callerWallet,r.sourceSignature,r.mint].join(':');
export function canonicalEchoPerCallSignerRequest(r:EchoPerCallSignerRequest):string{
 return [ECHO_PER_CALL_SIGNER_DOMAIN,r.audience,r.action,r.executionWallet,
  r.callerWallet,r.sourceSignature,r.mint,r.reservationKey,r.transactionSha256,
  r.nonceHex,String(r.issuedAtMs),String(r.expiresAtMs)].join('\n');
}
export async function admitEchoPerCallSignerV2(args:{
 request:EchoPerCallSignerRequest;signatureBase58:string;
 pinnedCoordinatorPublicKey:string;nowMs:number;
 unsignedTransactionBytes:Uint8Array;nonceStore:EchoNonceStore;
 reader:EchoPerCallReservationReader;preview:EchoJupiterV2PreviewResult;
}):Promise<{ok:true;mode:'PER_CALL_PREVIEW_ONLY';fingerprint:string;signingAllowed:false}
 |{ok:false;reason:string;signingAllowed:false}>{
 const deny=(reason:string)=>({ok:false as const,reason,signingAllowed:false as const});
 const r=args.request;
 const key=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/,signature=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/,
  hex=/^[0-9a-f]{64}$/;
 if(r.audience!=='echo-isolated-signer'||r.action!=='BUY'||
  r.executionWallet!==ECHO_EXPECTED_EXECUTION_WALLET||
  !key.test(r.callerWallet)||!key.test(r.mint)||!signature.test(r.sourceSignature)||
  r.reservationKey!==perCallKey(r)||!hex.test(r.transactionSha256)||
  !hex.test(r.nonceHex)||!Number.isSafeInteger(args.nowMs)||
  !Number.isSafeInteger(r.issuedAtMs)||!Number.isSafeInteger(r.expiresAtMs)||
  r.issuedAtMs>args.nowMs||r.expiresAtMs<args.nowMs||
  r.expiresAtMs-r.issuedAtMs>30000||r.expiresAtMs<=r.issuedAtMs)
  return deny('INVALID_PER_CALL_SIGNER_REQUEST');
 if(!args.preview.ok||args.preview.side!=='BUY'||!args.preview.unsignedAudit?.feeEstimateComplete||
  args.preview.unsignedTransactionSha256!==r.transactionSha256||
  args.preview.unsignedAudit.sha256!==r.transactionSha256)
  return deny('EXACT_BUY_SIMULATION_EVIDENCE_MISSING');
 const bytes=args.unsignedTransactionBytes;
 if(bytes.length<80||bytes.length>3072||
  createHash('sha256').update(bytes).digest('hex')!==r.transactionSha256)
  return deny('UNSIGNED_MESSAGE_HASH_MISMATCH');
 const audit=auditEchoUnsignedSwap(Buffer.from(bytes).toString('base64'),r.executionWallet);
 if(!audit.ok||audit.audit.sha256!==r.transactionSha256||
  !audit.audit.feeEstimateComplete)
  return deny('EXACT_UNSIGNED_SWAP_AUDIT_FAILED');
 // The coordinator signature MUST authenticate the exact per-call identity.
 try{
  const sender=new PublicKey(args.pinnedCoordinatorPublicKey);
  if(sender.toBase58()===r.executionWallet)return deny('COORDINATOR_CANNOT_BE_WALLET');
  const sig=bs58.decode(args.signatureBase58);
  if(sig.length!==64)return deny('INVALID_COORDINATOR_SIGNATURE');
  const der=Buffer.concat([
   Buffer.from('302a300506032b6570032100','hex'),Buffer.from(sender.toBytes())]);
  if(!verify(null,Buffer.from(canonicalEchoPerCallSignerRequest(r)),
    createPublicKey({key:der,format:'der',type:'spki'}),sig))
   return deny('INVALID_COORDINATOR_SIGNATURE');
 }catch{return deny('INVALID_COORDINATOR_SIGNATURE');}
 // Read only from trusted service-role DB, not from a Telegram payload.
 let row:EchoPerCallReservation|null;
 try{row=await args.reader.getByCall(r.executionWallet,r.sourceSignature);}
 catch{return deny('RESERVATION_DATABASE_UNAVAILABLE');}
 if(!row||row.executionWallet!==r.executionWallet||
  row.callerWallet!==r.callerWallet||row.mint!==r.mint||
  row.sourceSignature!==r.sourceSignature||row.state!=='reserved'||
  row.transactionSignature!==null||row.positionClosedAt!==null||
  exactRowNonnegativeInt(row.amountLamports)===null||
  exactRowNonnegativeInt(row.amountLamports)!<=0n||
  exactRowNonnegativeInt(row.allInCents)===null||
  exactRowNonnegativeInt(row.allInCents)!<1n||
  exactRowNonnegativeInt(row.allInCents)!>500n||
  args.preview.inputMint!=='So11111111111111111111111111111111111111112'||
  args.preview.outputMint!==r.mint||
  args.preview.inputRaw!==String(row.amountLamports))
  return deny('PER_CALL_RESERVATION_OR_ROUTE_MISMATCH');
 // Must be durable database-backed nonce store in production, atomically
 // consumed exactly once and shared by all signer replicas.
 try{
  if(!await args.nonceStore.consumeOnce(r.nonceHex,r.expiresAtMs))
   return deny('PER_CALL_NONCE_REPLAYED');
 }catch{return deny('PER_CALL_NONCE_STORAGE_UNAVAILABLE');}
 return {ok:true,mode:'PER_CALL_PREVIEW_ONLY',fingerprint:r.transactionSha256,
  signingAllowed:false};
}
