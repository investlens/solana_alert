/** Strict READ-ONLY PumpSwap inner-instruction evidence inspector.
 *
 * Parses the raw RPC simulation structure; refuses incomplete/unbound data.
 * This inspection does not prove CPI wallet debit or grant signing. Real CPI
 * provenance requires independent account owner, instruction and token-delta
 * decoding with the exact route/pools and a coherent context slot.
 */
import {createHash} from 'node:crypto';
import {VersionedTransaction} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_CPI_INSPECTION_SIGNING_ENABLED=false as const;
export type EchoRpcCpiSnapshot={
 exactUnsignedSha256:string;
 simulationErr:unknown;
 contextSlot:number;
 innerInstructions:unknown;
 preBalances:unknown;
 postBalances:unknown;
 accountKeys:unknown;
};
export type EchoCpiInspection=
 |{ok:true;mode:'INNER_INSTRUCTION_STRUCTURE_ONLY';
   unsignedSha256:string;innerInstructionCount:number;
   contextSlot:number;completeWalletDebitProven:false;
   signingAllowed:false;broadcastAllowed:false}
 |{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false};
const fail=(reason:string):EchoCpiInspection=>({
 ok:false,reason,signingAllowed:false,broadcastAllowed:false
});
const key=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function inspectEchoPumpRawCpi(input:{
 unsignedBytes:Uint8Array;simulation:EchoRpcCpiSnapshot;
}):EchoCpiInspection{
 const s=input.simulation;
 if(input.unsignedBytes.length<80||input.unsignedBytes.length>3072||
    !/^[0-9a-f]{64}$/.test(s.exactUnsignedSha256)||
    createHash('sha256').update(input.unsignedBytes).digest('hex')!==s.exactUnsignedSha256)
  return fail('UNBOUND_CPI_TRANSACTION');
 let tx:VersionedTransaction;
 try{tx=VersionedTransaction.deserialize(input.unsignedBytes);}
 catch{return fail('INVALID_UNSIGNED_TRANSACTION');}
 if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
    tx.message.header.numRequiredSignatures!==1||
    tx.signatures.length!==1||tx.signatures[0].some(x=>x!==0))
  return fail('UNTRUSTED_UNSIGNED_TRANSACTION');
 if(tx.message.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET)
  return fail('UNTRUSTED_CPI_FEE_PAYER');
 if(s.simulationErr!==null||!Number.isSafeInteger(s.contextSlot)||s.contextSlot<=0)
  return fail('SIMULATION_SUCCESS_AND_SLOT_REQUIRED');
 // A backend cannot independently audit CPI without all account keys,
 // balances and inner instructions; missing fields MUST NOT mean zero CPI.
 if(!Array.isArray(s.accountKeys)||s.accountKeys.length!==tx.message.staticAccountKeys.length||
    s.accountKeys.some((k,i)=>typeof k!=='string'||!key.test(k)||
      k!==tx.message.staticAccountKeys[i].toBase58()))
  return fail('UNTRUSTED_CPI_ACCOUNT_KEYS');
 const count=s.accountKeys.length;
 if(!Array.isArray(s.preBalances)||!Array.isArray(s.postBalances)||
    s.preBalances.length!==count||s.postBalances.length!==count||
    [...s.preBalances,...s.postBalances].some(
     v=>!Number.isSafeInteger(v as number)||(v as number)<0))
  return fail('MISSING_CPI_BALANCE_VECTOR');
 // A complete raw balance-vector claim must show a positive change for the
 // pinned payer. This still does NOT establish all token/CPI fee semantics.
 if((s.postBalances[0] as number)>=(s.preBalances[0] as number))
  return fail('NO_OBSERVED_FEE_PAYER_DEBIT');
 if(!Array.isArray(s.innerInstructions))
  return fail('MISSING_CPI_INNER_INSTRUCTIONS');
 const top=tx.message.compiledInstructions.length;
 let innerCount=0;
 const seen=new Set<number>();
 for(const group of s.innerInstructions){
  if(!group||typeof group!=='object')return fail('INVALID_CPI_GROUP');
  const g=group as Record<string,unknown>;
  if(!Number.isSafeInteger(g.index)||Number(g.index)<0||
     Number(g.index)>=top||seen.has(Number(g.index))||
     !Array.isArray(g.instructions))
   return fail('INVALID_CPI_GROUP');
  seen.add(Number(g.index));
  for(const raw of g.instructions){
   if(!raw||typeof raw!=='object')return fail('INVALID_CPI_INSTRUCTION');
   const ins=raw as Record<string,unknown>;
   if(!Number.isSafeInteger(ins.programIdIndex)||Number(ins.programIdIndex)<0||
      Number(ins.programIdIndex)>=count||
      !Array.isArray(ins.accounts)||ins.accounts.some(
        a=>!Number.isSafeInteger(a)||Number(a)<0||Number(a)>=count)||
      typeof ins.data!=='string'||ins.data.length>4096||
      (ins.data.length>0&&!/^[1-9A-HJ-NP-Za-km-z]+$/.test(ins.data)))
    return fail('INVALID_CPI_INSTRUCTION');
   innerCount++;
   if(innerCount>100)return fail('EXCESSIVE_CPI_INSTRUCTIONS');
  }
 }
 // Even complete structural RPC arrays do not prove that instruction data
 // is benign or that all lamport/rent/exit effects were economically bounded.
 return {ok:true,mode:'INNER_INSTRUCTION_STRUCTURE_ONLY',
  unsignedSha256:s.exactUnsignedSha256,innerInstructionCount:innerCount,
  contextSlot:s.contextSlot,completeWalletDebitProven:false,
  signingAllowed:false,broadcastAllowed:false};
}
