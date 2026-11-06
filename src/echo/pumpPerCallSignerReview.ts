/** STRICT no-sign PumpSwap per-call signer admission.
 *
 * The OFFLINE signer must obtain its own evidence via a pinned trusted
 * provider; coordinator-supplied true/false flags never grant signing.
 * This adapts the per-call nonce/DB identity to PumpSwap, without invoking
 * the Jupiter-only `auditEchoUnsignedSwap` or the legacy wallet:mint gate.
 *
 * IMPORTANT: this is NOT a live signer. The existing PumpSwap review helper
 * is necessary but NOT an independently audited CPI-proof by itself.
 */
import {createHash,createPublicKey,verify as verifyEd25519} from 'node:crypto';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from './liveBuyPolicy.js';
import {perCallKey,canonicalEchoPerCallSignerRequest,
 type EchoPerCallSignerRequest,type EchoPerCallReservationReader} from './perCallSignerAdmissionV2.js';
import type {EchoNonceStore} from './authenticatedSignerRequest.js';
import type {EchoFiveDollarCall} from './fiveDollarCallPolicy.js';
import {inspectPumpUnsignedPerCallHandoff,type PumpUnsignedProbe,
 type PumpIndependentEvidence} from './pumpUnsignedPerCallHandoff.js';
import type {EchoPumpSizeInput} from './fiveDollarPumpInputSizing.js';
import {auditEchoPumpSimulatedWalletDebit,
 type EchoPumpDebitEvidence} from './pumpSimulatedDebitEvidence.js';

export const ECHO_PUMP_SIGNER_REVIEW_CAN_SIGN=false as const;
export const ECHO_PUMP_SIGNER_REVIEW_CAN_BROADCAST=false as const;
export type EchoTrustedPumpObservation={
 call:EchoFiveDollarCall;
 probe:PumpUnsignedProbe;
 independent:PumpIndependentEvidence;
 sizing:EchoPumpSizeInput;
 debitEvidence:EchoPumpDebitEvidence;
 /** Trusted observer must attest against EXACT bytes and wallet state. */
};
export interface EchoTrustedPumpEvidenceReader{
 /** A pinned signer-owned provider, never untrusted coordinator JSON. */
 readFromTrustedProviders(wallet:string,mint:string,bytes:Uint8Array):
 Promise<EchoTrustedPumpObservation|null>;
}
export type EchoPumpSignerReviewResult=
 |{ok:true;mode:'PUMP_PER_CALL_REVIEW_ONLY';unsignedSha256:string;
   reservationKey:string;signingAllowed:false;broadcastAllowed:false}
 |{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false};
export async function reviewEchoPumpPerCallSignerNoBroadcast(args:{
 request:EchoPerCallSignerRequest;
 coordinatorSignatureBase58:string;
 pinnedCoordinatorPublicKey:string;
 nowMs:number;
 unsignedTransactionBytes:Uint8Array;
 nonceStore:EchoNonceStore;
 reservationReader:EchoPerCallReservationReader;
 evidenceReader:EchoTrustedPumpEvidenceReader;
}):Promise<EchoPumpSignerReviewResult>{
 const deny=(reason:string):EchoPumpSignerReviewResult=>
  ({ok:false,reason,signingAllowed:false,broadcastAllowed:false});
 const r=args.request;
 const signature=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
 const hash=/^[0-9a-f]{64}$/;
 if(r.action!=='BUY'||r.audience!=='echo-isolated-signer'||
  r.executionWallet!==ECHO_EXPECTED_EXECUTION_WALLET||
  ![SLINGOOR_WALLET,CHAIRMAN_WALLET].includes(r.callerWallet)||
  !signature.test(r.sourceSignature)||
  r.reservationKey!==perCallKey(r)||
  !hash.test(r.transactionSha256)||!hash.test(r.nonceHex)||
  !Number.isSafeInteger(args.nowMs)||
  !Number.isSafeInteger(r.issuedAtMs)||!Number.isSafeInteger(r.expiresAtMs)||
  r.issuedAtMs>args.nowMs||r.expiresAtMs<=r.issuedAtMs||
  r.expiresAtMs<args.nowMs||r.expiresAtMs-r.issuedAtMs>30000)
  return deny('INVALID_OR_UNTRUSTED_PER_CALL_REQUEST');
 const bytes=args.unsignedTransactionBytes;
 if(bytes.length<80||bytes.length>3072||
  createHash('sha256').update(bytes).digest('hex')!==r.transactionSha256)
  return deny('UNSIGNED_BYTES_HASH_MISMATCH');
 try{
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.header.numRequiredSignatures!==1||
    tx.signatures.length!==1||
    tx.signatures[0].some(b=>b!==0)||
    tx.message.staticAccountKeys[0]?.toBase58()!==r.executionWallet)
    return deny('UNTRUSTED_TRANSACTION_SIGNER');
 }catch{return deny('UNREADABLE_UNSIGNED_SWAP');}
 // The request domain/caller-source/transaction hash is cryptographically
 // authenticated; signing wallet key must not be coordinator identity.
 try{
  const coordinator=new PublicKey(args.pinnedCoordinatorPublicKey);
  if(coordinator.toBase58()===r.executionWallet)return deny('COORDINATOR_IS_WALLET');
  const raw=bs58.decode(args.coordinatorSignatureBase58);
  if(raw.length!==64)return deny('INVALID_COORDINATOR_SIGNATURE');
  const spki=Buffer.concat([
   Buffer.from('302a300506032b6570032100','hex'),
   Buffer.from(coordinator.toBytes())
  ]);
  if(!verifyEd25519(null,Buffer.from(canonicalEchoPerCallSignerRequest(r)),
    createPublicKey({key:spki,format:'der',type:'spki'}),raw))
    return deny('INVALID_COORDINATOR_SIGNATURE');
 }catch{return deny('INVALID_COORDINATOR_SIGNATURE');}
 // Fetch immutable reservation from DB and independently sourced chain/fee
 // evidence BEFORE consuming the nonce. No trust in supplied client flags.
 let row:Awaited<ReturnType<EchoPerCallReservationReader['getByCall']>>;
 try{row=await args.reservationReader.getByCall(r.executionWallet,r.sourceSignature);}
 catch{return deny('TRUSTED_RESERVATION_UNAVAILABLE');}
 if(!row||row.executionWallet!==r.executionWallet||
  row.callerWallet!==r.callerWallet||row.sourceSignature!==r.sourceSignature||
  row.mint!==r.mint||row.state!=='reserved'||
  row.transactionSignature!==null||row.positionClosedAt!==null||
  !Number.isSafeInteger(row.amountLamports)||row.amountLamports<=0||
  !Number.isSafeInteger(row.allInCents)||row.allInCents<1||row.allInCents>500)
  return deny('PER_CALL_RESERVATION_MISMATCH');
 let trusted:EchoTrustedPumpObservation|null;
 try{trusted=await args.evidenceReader.readFromTrustedProviders(
  r.executionWallet,r.mint,Uint8Array.from(bytes));}
 catch{return deny('PUMP_TRUSTED_EVIDENCE_UNAVAILABLE');}
 if(!trusted||!trusted.debitEvidence)return deny('PUMP_TRUSTED_EVIDENCE_UNAVAILABLE');
 // Independent numeric pre/post-wallet simulation evidence must agree with
 // the exact bytes, spending cap and signer-side cost bounds. Legacy booleans
 // alone cannot ever admit a PumpSwap signer review.
 const simulation=auditEchoPumpSimulatedWalletDebit(trusted.debitEvidence);
 if(!simulation.ok)return deny('PUMP_SIMULATED_DEBIT_UNVERIFIED');
 // A reservation below $5 is not enough: its booked USD amount must
 // equal the independently audited all-in amount for THESE exact bytes.
 // Otherwise a stale/understated DB reservation could pass signer review.
 if(!Number.isSafeInteger(Number(simulation.allInCents))||
    row.allInCents!==Number(simulation.allInCents))
   return deny('PUMP_RESERVED_USD_DEBIT_MISMATCH');
 if(simulation.unsignedSha256!==r.transactionSha256||
    simulation.plannedWalletDebitUpperBoundLamports!==
      (BigInt(trusted.call.principalLamports)+
       BigInt(trusted.call.networkAndPriorityFeeLamports)+
       BigInt(trusted.call.accountRentLamports)+
       BigInt(trusted.call.additionalCpiDebitLamports)).toString()||
    trusted.debitEvidence.solUsdCents!==trusted.call.solUsdPriceCents||
    trusted.debitEvidence.actualWalletBalanceBeforeLamports!==
      trusted.call.availableWalletLamports||
    trusted.debitEvidence.pendingReservedLamports!==trusted.call.pendingWalletDebitLamports||
    trusted.debitEvidence.exitReserveLamports!==trusted.call.sellReserveLamports)
   return deny('PUMP_SIMULATED_DEBIT_OR_SIZING_MISMATCH');
 const c=trusted.call;
 if(c.executionWallet!==r.executionWallet||c.callerWallet!==r.callerWallet||
  c.sourceSignature!==r.sourceSignature||c.mint!==r.mint||
  c.principalLamports!==String(row.amountLamports))
  return deny('PUMP_CALL_RESERVATION_MISMATCH');
 const audited=inspectPumpUnsignedPerCallHandoff({
  caller:c,unsignedTxBytes:bytes,probe:trusted.probe,
  independent:trusted.independent,sizing:trusted.sizing});
 if(!audited.ok)return deny('PUMP_INDEPENDENT_REVIEW_FAILED');
 if(audited.perCallReservationKey!==r.reservationKey||
  audited.fingerprint!==r.transactionSha256)
  return deny('PUMP_REVIEW_FINGERPRINT_MISMATCH');
 // Consume nonce once across all replicas. A passing review NEVER signs.
 try{
  if(!await args.nonceStore.consumeOnce(r.nonceHex,r.expiresAtMs))
   return deny('NONCE_ALREADY_CONSUMED');
 }catch{return deny('DURABLE_NONCE_UNAVAILABLE');}
 return {ok:true,mode:'PUMP_PER_CALL_REVIEW_ONLY',
  unsignedSha256:r.transactionSha256,reservationKey:r.reservationKey,
  signingAllowed:false,broadcastAllowed:false};
}
