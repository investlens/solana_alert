/** Isolated signer contract. This module NEVER signs or broadcasts.
 * A self-reported simulation flag is NOT independent proof of execution safety.
 * The actual signer needs trusted DB state, chain balance/authority inspection,
 * swap instruction decoding and a separate audit before enabling.
 */
import { VersionedTransaction, PublicKey, SystemProgram } from '@solana/web3.js';
import { verifyEchoExecutionWallet } from './executionWallet.js';
export type EchoIsolatedSignerRequest={
 executionWallet:string; mint:string; reservationKey:string;
 unsignedTransactionBase64:string; simulationVerified:boolean;
 destinationAndProgramsVerified:boolean; freshQuoteVerified:boolean;
};
export type EchoSignerApproval={ok:true;wallet:string}|{ok:false;reason:string};
const permittedPrograms=new Set([
 'ComputeBudget111111111111111111111111111111',
 '11111111111111111111111111111111',
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFCE7uFyV9QnF4jrb',
 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
]);
/** Validates raw message shape without authorizing a signature. */
export function inspectEchoUnsignedEnvelope(request:EchoIsolatedSignerRequest):
 {ok:true}|{ok:false;reason:string}{
 if(!verifyEchoExecutionWallet(request.executionWallet))return {ok:false,reason:'WALLET_MISMATCH'};
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(request.mint)||
   request.reservationKey!==request.executionWallet+':'+request.mint)
   return {ok:false,reason:'UNMATCHED_RESERVATION'};
 const body=request.unsignedTransactionBase64;
 if(typeof body!=='string'||body.length<100||body.length>4096||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body))
   return {ok:false,reason:'INVALID_UNSIGNED_TRANSACTION'};
 try{
  const bytes=Buffer.from(body,'base64');
  if(bytes.toString('base64')!==body)return {ok:false,reason:'INVALID_BASE64'};
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0 || tx.message.addressTableLookups.length!==0)
   return {ok:false,reason:'UNRESOLVED_LOOKUP_TABLES'};
  const keys=tx.message.staticAccountKeys;
  if(tx.message.header.numRequiredSignatures!==1||tx.signatures.length!==1||
     keys[0]?.toBase58()!==request.executionWallet||
     !tx.signatures[0].every(b=>b===0))
   return {ok:false,reason:'UNTRUSTED_SIGNER'};
  for(const instruction of tx.message.compiledInstructions){
   const program=keys[instruction.programIdIndex]?.toBase58();
   if(!program||!permittedPrograms.has(program))
    return {ok:false,reason:'UNREVIEWED_PROGRAM'};
   if(program===SystemProgram.programId.toBase58() && instruction.data.length>=4 &&
      Buffer.from(instruction.data).readUInt32LE(0)===2)
    return {ok:false,reason:'UNEXPECTED_SOL_TRANSFER'};
  }
  return {ok:true};
 }catch{return {ok:false,reason:'INVALID_TRANSACTION_MESSAGE'};}
}
/** ALWAYS fails closed until an independently audited signer is implemented.
 * Boolean flags from a request do not authorize an actual purchase or sale.
 */
export function reviewEchoSignerRequest(request:EchoIsolatedSignerRequest):EchoSignerApproval {
 const inspected=inspectEchoUnsignedEnvelope(request);
 if('reason' in inspected)return {ok:false,reason:inspected.reason};
 return {ok:false,reason:'INDEPENDENT_VERIFICATION_AND_SIGNER_NOT_INTEGRATED'};
}
export const ECHO_SIGNER_ENABLED=false as const;
