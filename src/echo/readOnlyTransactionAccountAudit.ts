/**
 * Independent read-only review of a Solana v0 unsigned transaction.
 * This is evidence for human review, never authorization to sign/broadcast.
 * Lookup tables are fetched by an injected read-only provider; no wallet
 * secrets, builder-provided "verified" booleans, or transaction execution.
 */
import {AddressLookupTableAccount,ComputeBudgetProgram,PublicKey,SystemProgram,
 VersionedTransaction} from '@solana/web3.js';
import type {EchoLookupTableProvider} from './readOnlyAddressLookupInspection.js';

export const ECHO_ACCOUNT_AUDIT_GRANTS_SIGNING=false as const;
const ACTIVE_SLOT=18446744073709551615n;
const MAX_ALTS=6,MAX_IX=48,MAX_ACCOUNTS=128,MAX_CU=400_000;
const MAX_PRIORITY_LAMPORTS=500_000n; // analysis ceiling; not a signer spend limit
export type EchoAccountAudit=
 |{ok:true;mode:'INSPECT_ONLY';feePayer:string;lookupTables:number;
   accountCount:number;readonlyAccounts:string[];writableAccounts:string[];
   invokedPrograms:string[];unknownPrograms:string[];
   computeUnitLimit:number;computeUnitPriceMicroLamports:string;
   estimatedPriorityFeeLamports:string;estimatedSignatureFeeLamports:string;
   accountDataAndRentNotVerified:true;tokenDestinationsNotVerified:true;
   signingApproved:false}
 |{ok:false;reason:string;signingApproved:false};

const reviewPrograms=new Set([
 ComputeBudgetProgram.programId.toBase58(),SystemProgram.programId.toBase58(),
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFCE7uFyV9QnF4jrb',
 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
]);
const reject=(reason:string):EchoAccountAudit=>({ok:false,reason,signingApproved:false});
export async function auditEchoUnsignedV0Transaction(args:{
 base64:string;expectedFeePayer:string;lookupProvider:EchoLookupTableProvider;
}):Promise<EchoAccountAudit>{
 let tx:VersionedTransaction;
 try{
  if(typeof args.base64!=='string'||args.base64.length<100||
     args.base64.length>4096||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.base64))
    return reject('INVALID_UNSIGNED_BYTES');
  const bytes=Buffer.from(args.base64,'base64');
  if(bytes.toString('base64')!==args.base64)return reject('INVALID_UNSIGNED_BYTES');
  tx=VersionedTransaction.deserialize(bytes);
 }catch{return reject('INVALID_UNSIGNED_BYTES');}
 const msg=tx.message;
 if(msg.version!==0||msg.header.numRequiredSignatures!==1||
    tx.signatures.length!==1||!tx.signatures[0].every(x=>x===0)||
    msg.staticAccountKeys[0]?.toBase58()!==args.expectedFeePayer)
  return reject('UNTRUSTED_FEE_PAYER_OR_SIGNATURES');
 if(msg.addressTableLookups.length>MAX_ALTS||msg.compiledInstructions.length>MAX_IX)
  return reject('EXCESSIVE_TRANSACTION_COMPLEXITY');

 const lookups:AddressLookupTableAccount[]=[];
 const seen=new Set<string>();
 for(const l of msg.addressTableLookups){
  const key=l.accountKey.toBase58();
  if(seen.has(key))return reject('DUPLICATE_LOOKUP_TABLE');
  seen.add(key);
  let resolved:AddressLookupTableAccount|null;
  try{resolved=await args.lookupProvider.lookup(l.accountKey)}
  catch{return reject('LOOKUP_RPC_UNAVAILABLE');}
  if(!resolved||!resolved.key.equals(l.accountKey))return reject('LOOKUP_ACCOUNT_MISSING');
  if(resolved.state.deactivationSlot!==ACTIVE_SLOT)
   return reject('LOOKUP_TABLE_DEACTIVATED');
  if([...l.readonlyIndexes,...l.writableIndexes].some(i=>i>=resolved.state.addresses.length))
   return reject('LOOKUP_INDEX_OUT_OF_BOUNDS');
  lookups.push(resolved);
 }
 try{
  const keys=msg.getAccountKeys({addressLookupTableAccounts:lookups});
  if(keys.length>MAX_ACCOUNTS)return reject('TOO_MANY_ACCOUNTS');
  const writableAccounts:string[]=[],readonlyAccounts:string[]=[];
  for(let i=0;i<keys.length;i++){
   const k=keys.get(i)?.toBase58();
   if(!k)return reject('ACCOUNT_RESOLUTION_FAILED');
   (msg.isAccountWritable(i)?writableAccounts:readonlyAccounts).push(k);
  }
  const programs:string[]=[];
  let limit=200_000,price=0n,limitSeen=false,priceSeen=false;
  for(const ix of msg.compiledInstructions){
   const program=keys.get(ix.programIdIndex)?.toBase58();
   if(!program)return reject('UNRESOLVED_PROGRAM');
   programs.push(program);
   if(program===SystemProgram.programId.toBase58()&&ix.data.length>=4&&
      Buffer.from(ix.data).readUInt32LE(0)===2)
    return reject('DIRECT_SOL_TRANSFER_REQUIRES_INDEPENDENT_REVIEW');
   if(program!==ComputeBudgetProgram.programId.toBase58())continue;
   const data=Buffer.from(ix.data),discriminator=data[0];
   if(discriminator===2&&data.length===5){
    if(limitSeen)return reject('DUPLICATE_COMPUTE_LIMIT');
    limitSeen=true;limit=data.readUInt32LE(1);
   }else if(discriminator===3&&data.length===9){
    if(priceSeen)return reject('DUPLICATE_COMPUTE_PRICE');
    priceSeen=true;price=data.readBigUInt64LE(1);
   }else return reject('UNREVIEWED_COMPUTE_BUDGET_INSTRUCTION');
  }
  if(limit<1||limit>MAX_CU)return reject('COMPUTE_LIMIT_EXCEEDS_REVIEW_CEILING');
  const priorityFee=(BigInt(limit)*price+999_999n)/1_000_000n;
  if(priorityFee>MAX_PRIORITY_LAMPORTS)return reject('PRIORITY_FEE_EXCEEDS_REVIEW_CEILING');
  const unknownPrograms=[...new Set(programs.filter(p=>!reviewPrograms.has(p)))];
  return {ok:true,mode:'INSPECT_ONLY',feePayer:args.expectedFeePayer,
   lookupTables:lookups.length,accountCount:keys.length,
   readonlyAccounts,writableAccounts,invokedPrograms:programs,unknownPrograms,
   computeUnitLimit:limit,computeUnitPriceMicroLamports:String(price),
   estimatedPriorityFeeLamports:String(priorityFee),
   estimatedSignatureFeeLamports:'5000', // estimate only; actual network fee must be verified
   accountDataAndRentNotVerified:true,tokenDestinationsNotVerified:true,
   signingApproved:false};
 }catch{return reject('ACCOUNT_OR_FEE_AUDIT_FAILED');}
}
