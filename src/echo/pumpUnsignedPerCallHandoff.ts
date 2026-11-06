/** Link actual official PumpSwap unsigned diagnostics to Echo's per-source
 * signer-review workflow, without giving the diagnostic execution authority.
 * This validates the exact unsigned-byte fingerprint against an independently
 * supplied real-world simulation and wallet-debit attestation. There is no
 * signature, nonce consumption or broadcast here: v2 signer must independently
 * authenticate the exact bytes, source call and durable reservation.
 */
import {createHash} from 'node:crypto';
import {ComputeBudgetProgram,PublicKey,SystemProgram,VersionedTransaction} from '@solana/web3.js';
import {screenEchoFiveDollarCall,type EchoFiveDollarCall} from './fiveDollarCallPolicy.js';
import {perCallKey} from './perCallSignerAdmissionV2.js';
const AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const PROGRAMS=new Set([AMM,TOKEN,TOKEN2022,ATA,
 SystemProgram.programId.toBase58(),ComputeBudgetProgram.programId.toBase58()]);
export const ECHO_PUMP_PER_CALL_HANDOFF_SIGNING_ENABLED=false as const;
export const ECHO_PUMP_PER_CALL_HANDOFF_BROADCAST_ENABLED=false as const;
export type PumpUnsignedProbe={
 unsignedTransactionSha256:string|null;
 unsignedConstructed:boolean;simulationPassed:boolean;
 quoteVerified:boolean;fullWalletDebitVerified:boolean;
 currentWalletLamports:number|null;
 networkBaseFeeLamports:number|null;
 cpiRentAndExtraWalletDebitsAudited:boolean;
 /** Legacy fixed 0.025 SOL diagnostic is not a $5 per-call authorization. */
 amountLamports:number;targetMint:string;
};
export type PumpIndependentEvidence={
 /** Independent trusted read of EXACT unsigned message, simulation and costs. */
 simulationMatchesExactBytes:boolean;
 allCpiAndRentDebitsIndependentlyAudited:boolean;
 manualPhantomSellReserveIndependentlyAudited:boolean;
 freshSolUsdAndBalanceVerified:boolean;
};
export type PumpHandoffResult=
 |{ok:true;mode:'UNSIGNED_REVIEW_ONLY';fingerprint:string;perCallReservationKey:string;
    signerAllowed:false;broadcastAllowed:false}
 |{ok:false;reason:string;signerAllowed:false;broadcastAllowed:false};
export function inspectPumpUnsignedPerCallHandoff(x:{
 caller:EchoFiveDollarCall; unsignedTxBytes:Uint8Array;
 probe:PumpUnsignedProbe; independent:PumpIndependentEvidence;
}):PumpHandoffResult{
 const deny=(reason:string):PumpHandoffResult=>({
  ok:false,reason,signerAllowed:false,broadcastAllowed:false});
 const d=screenEchoFiveDollarCall(x.caller);
 if(!d.eligible)return deny('PER_CALL_POLICY_'+d.reason);
 if(!x.probe.unsignedConstructed||!x.probe.quoteVerified||
    !x.probe.simulationPassed||!x.probe.fullWalletDebitVerified||
    !x.probe.cpiRentAndExtraWalletDebitsAudited||
    !x.independent.simulationMatchesExactBytes||
    !x.independent.allCpiAndRentDebitsIndependentlyAudited||
    !x.independent.manualPhantomSellReserveIndependentlyAudited||
    !x.independent.freshSolUsdAndBalanceVerified)
  return deny('INDEPENDENT_PUMP_SIMULATION_OR_FULL_DEBIT_NOT_VERIFIED');
 const b=x.unsignedTxBytes;
 if(b.length<80||b.length>3072||!x.probe.unsignedTransactionSha256||
   !/^[0-9a-f]{64}$/.test(x.probe.unsignedTransactionSha256))
  return deny('MISSING_EXACT_PUMP_TRANSACTION_BYTES');
 const hash=createHash('sha256').update(b).digest('hex');
 if(hash!==x.probe.unsignedTransactionSha256)return deny('PUMP_MESSAGE_HASH_MISMATCH');
 if(x.probe.targetMint!==x.caller.mint||
    x.probe.amountLamports!==Number(x.caller.principalLamports)||
    x.probe.networkBaseFeeLamports!==Number(x.caller.networkAndPriorityFeeLamports)||
    x.probe.currentWalletLamports!==Number(x.caller.availableWalletLamports))
  return deny('PUMP_QUOTE_FEES_OR_WALLET_MISMATCH');
 let tx:VersionedTransaction;
 try{tx=VersionedTransaction.deserialize(b);}catch{return deny('PUMP_UNSIGNED_PARSE_FAILURE');}
 const msg=tx.message;
 if(msg.version!==0||msg.addressTableLookups.length!==0||
    msg.header.numRequiredSignatures!==1||tx.signatures.length!==1||
    !tx.signatures[0].every(byte=>byte===0)||
    msg.staticAccountKeys[0]?.toBase58()!==x.caller.executionWallet)
  return deny('UNVERIFIED_PUMP_SIGNER_OR_LOOKUP');
 const keys=msg.staticAccountKeys.map(k=>k.toBase58());
 let swaps=0,transferred=0n;
 for(const ix of msg.compiledInstructions){
  if(ix.programIdIndex>=keys.length||
     ix.accountKeyIndexes.some(k=>k>=keys.length))return deny('INVALID_PUMP_ACCOUNT_INDEX');
  const program=keys[ix.programIdIndex];
  if(!PROGRAMS.has(program))return deny('UNREVIEWED_PUMP_PROGRAM');
  if(program===AMM)swaps++;
  if(program===SystemProgram.programId.toBase58()){
   const raw=Buffer.from(ix.data);
   if(raw.length!==12||raw.readUInt32LE(0)!==2||
      keys[ix.accountKeyIndexes[0]]!==x.caller.executionWallet)
    return deny('UNREVIEWED_PUMP_SYSTEM_INSTRUCTION');
   transferred+=raw.readBigUInt64LE(4);
  }
 }
 if(swaps!==1||transferred!==BigInt(x.caller.principalLamports))
  return deny('PUMP_SWAP_OR_PRINCIPAL_MISMATCH');
 // Only trace the connection; do not reuse Jupiter-only signer audit or
 // promote self-attested simulation booleans into an execution permit.
 return {ok:true,mode:'UNSIGNED_REVIEW_ONLY',fingerprint:hash,
  perCallReservationKey:perCallKey(x.caller),
  signerAllowed:false,broadcastAllowed:false};
}
