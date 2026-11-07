/** Normalize Solana simulateTransaction CPI without weakening SOL payer accounting.
 * Providers may return compiled, partially decoded, or jsonParsed CPI even
 * when the read-only caller requested compiled. Never invent a System debit.
 * Fully parsed non-System CPI is intentionally opaque: the payer SOL ledger
 * only attests System-program operations, NOT token effects.
 */
import {PublicKey,SystemProgram,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
export const ECHO_NORMALIZED_CPI_CAN_SIGN=false as const;
export const ECHO_NORMALIZED_CPI_CAN_BROADCAST=false as const;
const SYSTEM=SystemProgram.programId.toBase58();
const opaquePrograms=new Set([
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
]);
const natural=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const obj=(v:unknown):v is Record<string,unknown>=>
 v!==null&&typeof v==='object'&&!Array.isArray(v);
export type IndexedCpi={
 index:number;instructions:Array<{
  programIdIndex:number;accounts:number[];data:string;
  /** True only for allowed non-System JSON-parsed CPI. Not a token audit. */
  opaqueParsedNonSystem?:true
 }>
};
const number=(v:unknown):number=>{
 if(!natural(v))throw Error('NON_INTEGER_CPI_LAMPORT_AMOUNT');
 return Number(v);
};
const pub=(v:unknown):PublicKey=>{
 if(typeof v!=='string')throw Error('INVALID_PARSED_CPI_ADDRESS');
 return new PublicKey(v);
};
export function normalizeSignerSimulationCpi(
 raw:unknown,tx:VersionedTransaction
):IndexedCpi[]{
 if(!Array.isArray(raw)||raw.length>32)
  throw Error('MISSING_OR_EXCESSIVE_CPI_GROUPS');
 if(tx.message.version!==0||tx.message.addressTableLookups.length!==0)
  throw Error('UNTRUSTED_CPI_MESSAGE_VERSION');
 const keys=tx.message.staticAccountKeys.map(k=>k.toBase58());
 const indexOf=(address:unknown):number=>{
  const k=pub(address).toBase58(),i=keys.indexOf(k);
  if(i<0)throw Error('CPI_ADDRESS_NOT_IN_EXACT_MESSAGE');
  return i;
 };
 const seen=new Set<number>();let total=0;
 return raw.map(g=>{
  if(!obj(g)||!Number.isSafeInteger(g.index)||Number(g.index)<0||
     Number(g.index)>=tx.message.compiledInstructions.length||
     seen.has(Number(g.index))||!Array.isArray(g.instructions))
   throw Error('INVALID_CPI_GROUP');
  seen.add(Number(g.index));
  const instructions=g.instructions.map(item=>{
   if(++total>100||!obj(item))throw Error('INVALID_OR_EXCESSIVE_CPI');
   if(Number.isSafeInteger(item.programIdIndex)){
    const programIdIndex=Number(item.programIdIndex);
    if(programIdIndex<0||programIdIndex>=keys.length||
       !Array.isArray(item.accounts)||item.accounts.some(x=>
         !Number.isSafeInteger(x)||Number(x)<0||Number(x)>=keys.length)||
       typeof item.data!=='string'||item.data.length>4096||
       (item.data.length>0&&!/^[1-9A-HJ-NP-Za-km-z]+$/.test(item.data)))
     throw Error('INVALID_COMPILED_CPI');
    return {programIdIndex,accounts:item.accounts.map(Number),data:item.data};
   }
   const programIdIndex=indexOf(item.programId);
   const program=keys[programIdIndex];
   // Partially decoded CPI preserves its original base58 data and account order.
   if(Array.isArray(item.accounts)&&typeof item.data==='string'&&
      !('parsed' in item)){
    if(item.accounts.length>64||item.data.length>4096||
       (item.data.length>0&&!/^[1-9A-HJ-NP-Za-km-z]+$/.test(item.data)))
     throw Error('INVALID_PARTIALLY_DECODED_CPI');
    return {programIdIndex,accounts:item.accounts.map(indexOf),data:item.data};
   }
   if(!obj(item.parsed)||typeof item.parsed.type!=='string'||
      !obj(item.parsed.info))
    throw Error('UNRECONSTRUCTABLE_PARSED_CPI');
   const parsed=item.parsed,info=parsed.info;
   // Only two System operations are independently reconstructable from
   // parsed RPC fields and can debit the wallet in this version.
   if(program===SYSTEM){
    let ix;
    if(parsed.type==='transfer'){
     ix=SystemProgram.transfer({
      fromPubkey:pub(info.source),toPubkey:pub(info.destination),
      lamports:number(info.lamports)});
    }else if(parsed.type==='createAccount'){
     ix=SystemProgram.createAccount({
      fromPubkey:pub(info.source),newAccountPubkey:pub(info.newAccount),
      lamports:number(info.lamports),space:number(info.space),
      programId:pub(info.owner)});
    }else throw Error('UNREVIEWED_PARSED_SYSTEM_CPI');
    return {programIdIndex,accounts:ix.keys.map(k=>indexOf(k.pubkey.toBase58())),
     data:bs58.encode(ix.data)};
   }
   // This is NOT reconstruction of token instructions. It only preserves
   // their program identity for the payer-SOL delta reconciliation.
   if(!opaquePrograms.has(program)||item.parsed.type.length>80||
      Object.keys(info).length>32)
    throw Error('UNREVIEWED_PARSED_NON_SYSTEM_CPI');
   return {programIdIndex,accounts:[],data:'',opaqueParsedNonSystem:true as const};
  });
  return {index:Number(g.index),instructions};
 });
}
