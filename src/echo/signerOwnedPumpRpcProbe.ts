/** Signer-side READ-ONLY evidence acquisition for the EXACT PumpSwap bytes.
 * Fetches wallet state, message fees and simulation from a pinned connection
 * in the isolated trust boundary. Unlike JSON booleans from a coordinator,
 * this never accepts a caller-provided success report.
 *
 * This is intentionally NOT an independent CPI/exit-cost proof and can
 * NEVER authorize signing or broadcasting. Fee payer balance changes in
 * simulateTransaction are diagnostic, not a full economic attestation.
 */
import {createHash} from 'node:crypto';
import {Connection,PublicKey,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_SIGNER_RPC_PROBE_CAN_SIGN=false as const;
export const ECHO_SIGNER_RPC_PROBE_CAN_BROADCAST=false as const;
export type EchoSignerRpcProbeResult=
 |{ok:true;mode:'SIGNER_RPC_PROVISIONAL_ONLY';unsignedSha256:string;
   payerBalanceBeforeLamports:string;payerBalanceAfterSimulationLamports:string;
   observedDeltaLamports:string;networkFeeEstimateLamports:string;
   observedAtMs:number;simulationContextSlot:number;innerInstructionCount:number;
   computeUnitsConsumed:number|null;
   fullCpiAndExitProven:false;
   signingAllowed:false;broadcastAllowed:false}
 |{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false};
export type EchoSignerRpcReadOnly={
 getBalanceAndContext(wallet:PublicKey,commitment:'confirmed'):
  Promise<{context:{slot:number};value:number}>;
 getFeeForMessage(message:VersionedTransaction['message'],commitment:'confirmed'):
   Promise<{context:{slot:number};value:number|null}>;
 isBlockhashValid(blockhash:string,commitment:'confirmed'):
   Promise<{context:{slot:number};value:boolean}>;
 simulateTransaction(tx:VersionedTransaction,config:{
  sigVerify:false;replaceRecentBlockhash:false;commitment:'confirmed';
  minContextSlot:number;
  innerInstructions:true;
  accounts:{encoding:'base64';addresses:string[]}
 }):Promise<{context:{slot:number};value:{err:unknown;innerInstructions?:unknown;
  accounts?:({lamports:number;owner:string}|null)[]|null;
  unitsConsumed?:number|null}}>;
};
const deny=(reason:string):EchoSignerRpcProbeResult=>({
 ok:false,reason,signingAllowed:false,broadcastAllowed:false
});
/** Pass an independently configured, endpoint-pinned Connection or test stub.
 * Never take an RPC URL from an alert or signer request. Caller may not
 * supply prior balance or simulation booleans.
 */
export async function probeSignerOwnedPumpRpc(input:{
 connection:EchoSignerRpcReadOnly;
 unsignedBytes:Uint8Array;
 expectedUnsignedSha256:string;
 nowMs:number;
 /** Local signer-only observer for the actual validated RPC simulation,
  * never client-supplied evidence. Called only after all structural checks.
  */
 onValidatedSimulation?:(snapshot:{
  innerInstructions:unknown;payerBeforeLamports:number;
  payerAfterLamports:number;networkFeeLamports:number;
  simulationSlot:number;
 })=>void;
}):Promise<EchoSignerRpcProbeResult>{
 if(!Number.isSafeInteger(input.nowMs)||input.unsignedBytes.length<80||
    input.unsignedBytes.length>3072||
    !/^[0-9a-f]{64}$/.test(input.expectedUnsignedSha256))
  return deny('INVALID_SIGNER_RPC_INPUT');
 const sha=createHash('sha256').update(input.unsignedBytes).digest('hex');
 if(sha!==input.expectedUnsignedSha256)
  return deny('EXACT_TRANSACTION_HASH_MISMATCH');
 let tx:VersionedTransaction;
 try{tx=VersionedTransaction.deserialize(input.unsignedBytes);}
 catch{return deny('UNREADABLE_UNSIGNED_TRANSACTION');}
 if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
    tx.message.header.numRequiredSignatures!==1||
    tx.signatures.length!==1||tx.signatures[0].some(v=>v!==0)||
    tx.message.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET)
  return deny('UNTRUSTED_MESSAGE_SIGNER_OR_ALTS');
 const payer=new PublicKey(ECHO_EXPECTED_EXECUTION_WALLET);
 // Never replace the transaction blockhash during simulation: that would
 // simulate different message bytes than the coordinator-authenticated hash.
 // Expired blockhashes must fail closed and be rebuilt/requoted.
 // Require simulation at or after wallet-balance observation slot.
 // This excludes older RPC snapshots, but does not guarantee identical
 // state or prove full CPI/exit expenses.
 try{
  const balance=await input.connection.getBalanceAndContext(payer,'confirmed');
  const before=balance.value;
  if(!Number.isSafeInteger(balance.context?.slot)||balance.context.slot<=0)
   return deny('MISSING_WALLET_BALANCE_CONTEXT_SLOT');
  // A fee response or blockhash check from an older bank than the wallet
  // observation cannot establish that the exact message remains valid.
  const fee=await input.connection.getFeeForMessage(tx.message,'confirmed');
  if(!Number.isSafeInteger(fee.context?.slot)||
     fee.context.slot<balance.context.slot)
   return deny('STALE_FEE_CONTEXT_SLOT');
  const blockhash=await input.connection.isBlockhashValid(
   tx.message.recentBlockhash,'confirmed');
  if(!Number.isSafeInteger(blockhash.context?.slot)||
     blockhash.context.slot<balance.context.slot||blockhash.value!==true)
   return deny('EXPIRED_OR_STALE_MESSAGE_BLOCKHASH');
  if(!Number.isSafeInteger(before)||before<0||
     !Number.isSafeInteger(fee.value)||fee.value===null||fee.value<=0)
   return deny('UNVERIFIED_PAYER_BALANCE_OR_NETWORK_FEE');
  // A zero-balance wallet cannot produce a valid positive-debit BUY.
  if(before<=fee.value)return deny('UNFUNDED_PAYER_CANNOT_SIMULATE_BUY');
  const result=await input.connection.simulateTransaction(tx,{
   sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed',
   minContextSlot:Math.max(balance.context.slot,fee.context.slot,blockhash.context.slot),
   innerInstructions:true,
   accounts:{encoding:'base64',addresses:[ECHO_EXPECTED_EXECUTION_WALLET]}
  });
  if(result.value.err!==null)return deny('PUMPSWAP_SIMULATION_FAILED');
  const units=result.value.unitsConsumed;
  if(units!==undefined&&units!==null&&
     (!Number.isSafeInteger(units)||units<0||units>1_400_000))
   return deny('INVALID_SIMULATED_COMPUTE_CONSUMPTION');
  // Require an explicitly requested inner-CPI trace; absence is UNKNOWN,
  // never evidence that the transaction has no CPI debits.
  if(!Array.isArray(result.value.innerInstructions))
   return deny('MISSING_SIGNER_OWNED_CPI_TRACE');
  if(!Number.isSafeInteger(result.context?.slot)||
     result.context.slot<Math.max(balance.context.slot,fee.context.slot,blockhash.context.slot))
   return deny('MISSING_SIMULATION_CONTEXT_SLOT');
  // Bind every returned inner group to a valid compiled instruction index.
  // This is structure validation only: it does not decode CPI effects or
  // prove that the simulated slot shares state with the balance read.
  let count=0;
  const seen=new Set<number>();
  for(const group of result.value.innerInstructions){
   if(!group||typeof group!=='object')
    return deny('MALFORMED_SIGNER_CPI_GROUP');
   const g=group as Record<string,unknown>;
   if(!Number.isSafeInteger(g.index)||Number(g.index)<0||
      Number(g.index)>=tx.message.compiledInstructions.length||
      seen.has(Number(g.index))||!Array.isArray(g.instructions))
    return deny('MALFORMED_SIGNER_CPI_GROUP');
   seen.add(Number(g.index));
   for(const ix of g.instructions){
    if(!ix||typeof ix!=='object')return deny('MALFORMED_SIGNER_CPI_INSTRUCTION');
    const item=ix as Record<string,unknown>;
    if(!Number.isSafeInteger(item.programIdIndex)||
       Number(item.programIdIndex)<0||
       Number(item.programIdIndex)>=tx.message.staticAccountKeys.length||
       !Array.isArray(item.accounts)||
       item.accounts.some(i=>!Number.isSafeInteger(i)||Number(i)<0||
          Number(i)>=tx.message.staticAccountKeys.length)||
       typeof item.data!=='string'||item.data.length>4096||
       (item.data.length>0&&!/^[1-9A-HJ-NP-Za-km-z]+$/.test(item.data)))
     return deny('MALFORMED_SIGNER_CPI_INSTRUCTION');
    count++;
    if(count>100)return deny('EXCESSIVE_SIGNER_CPI_TRACE');
   }
  }
  if(!Array.isArray(result.value.accounts)||result.value.accounts.length!==1)
   return deny('UNEXPECTED_SIMULATION_ACCOUNT_SNAPSHOT');
  const after=result.value.accounts[0];
  if(!after||after.owner!==SystemProgram.programId.toBase58()||
     !Number.isSafeInteger(after.lamports)||after.lamports<0||
     after.lamports>=before)
   return deny('MISSING_OR_INVALID_SIMULATED_PAYER_BALANCE');
  const delta=before-after.lamports;
  input.onValidatedSimulation?.({
   innerInstructions:result.value.innerInstructions,
   payerBeforeLamports:before,payerAfterLamports:after.lamports,
   networkFeeLamports:fee.value,simulationSlot:result.context.slot
  });
  // RPC versions differ on whether simulated account lamports include
  // transaction fees. Do not assume this delta is full all-in wallet cost.
  return {ok:true,mode:'SIGNER_RPC_PROVISIONAL_ONLY',
   unsignedSha256:sha,payerBalanceBeforeLamports:String(before),
   payerBalanceAfterSimulationLamports:String(after.lamports),
   observedDeltaLamports:String(delta),
   networkFeeEstimateLamports:String(fee.value),
   observedAtMs:input.nowMs,simulationContextSlot:result.context.slot,
   innerInstructionCount:count,computeUnitsConsumed:units??null,
   fullCpiAndExitProven:false,
   signingAllowed:false,broadcastAllowed:false};
 }catch{return deny('SIGNER_RPC_READ_OR_SIMULATION_UNAVAILABLE');}
}
// Compile-time guard: this module deliberately accepts only read methods,
// never sendTransaction, sendRawTransaction, or a private signing key.
void (0 as unknown as Connection | undefined);
