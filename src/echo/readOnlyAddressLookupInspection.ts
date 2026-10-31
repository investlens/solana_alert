/** Read-only v0 address-lookup-table diagnostics. No transaction signing or submission.
 * Resolves lookup addresses with Solana RPC and reports instruction program IDs
 * to help audit Jupiter routes that a fail-closed signer currently rejects.
 * THIS IS NOT economic/account authorization to sign.
 */
import {AddressLookupTableAccount,Connection,PublicKey,VersionedTransaction} from '@solana/web3.js';
const MAX_ALTS=6;
const MAX_INSTRUCTIONS=48;
export type EchoResolvedV0Diagnostics=
 | {ok:true;mode:'INSPECT_ONLY';lookupTableCount:number;accountCount:number;
    programIds:string[];unknownPrograms:string[]}
 | {ok:false;reason:string};
const knownPrograms=new Set([
 'ComputeBudget111111111111111111111111111111',
 '11111111111111111111111111111111',
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFCE7uFyV9QnF4jrb',
 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
]);
export interface EchoLookupTableProvider {
 lookup(address:PublicKey):Promise<AddressLookupTableAccount|null>;
}
export function makeEchoRpcLookupProvider(connection:Connection):EchoLookupTableProvider{
 return {async lookup(address){
  const result=await connection.getAddressLookupTable(address,'confirmed');
  return result.value;
 }};
}
export async function inspectEchoV0LookupTables(
 unsignedBase64:string,provider:EchoLookupTableProvider
):Promise<EchoResolvedV0Diagnostics>{
 let tx:VersionedTransaction;
 try{
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(unsignedBase64)||
     unsignedBase64.length<100||unsignedBase64.length>4096)
   return {ok:false,reason:'INVALID_TRANSACTION_BYTES'};
  const bytes=Buffer.from(unsignedBase64,'base64');
  if(bytes.toString('base64')!==unsignedBase64)
   return {ok:false,reason:'INVALID_TRANSACTION_BYTES'};
  tx=VersionedTransaction.deserialize(bytes);
 }catch{return {ok:false,reason:'INVALID_TRANSACTION_BYTES'};}
 if(tx.message.version!==0||tx.message.header.numRequiredSignatures!==1||
    tx.signatures.length!==1||!tx.signatures[0].every(b=>b===0))
  return {ok:false,reason:'UNTRUSTED_TRANSACTION_ENVELOPE'};
 const lookups=tx.message.addressTableLookups;
 if(lookups.length>MAX_ALTS||tx.message.compiledInstructions.length>MAX_INSTRUCTIONS)
  return {ok:false,reason:'TRANSACTION_TOO_COMPLEX'};
 const accounts:AddressLookupTableAccount[]=[];
 const unique=new Set<string>();
 for(const lookup of lookups){
  const address=lookup.accountKey.toBase58();
  if(unique.has(address))return {ok:false,reason:'DUPLICATE_LOOKUP_TABLE'};
  unique.add(address);
  let entry:AddressLookupTableAccount|null;
  try{entry=await provider.lookup(lookup.accountKey)}
  catch{return {ok:false,reason:'LOOKUP_RPC_UNAVAILABLE'};}
  if(!entry||!entry.key.equals(lookup.accountKey))
   return {ok:false,reason:'LOOKUP_ACCOUNT_MISSING'};
  // Reject deactivated lookup tables (u64::MAX is active).
  if(entry.state.deactivationSlot!==BigInt('18446744073709551615'))
   return {ok:false,reason:'LOOKUP_ACCOUNT_DEACTIVATED'};
  for(const i of [...lookup.readonlyIndexes,...lookup.writableIndexes])
   if(i>=entry.state.addresses.length)return {ok:false,reason:'LOOKUP_INDEX_OUT_OF_BOUNDS'};
  accounts.push(entry);
 }
 try{
  const keys=tx.message.getAccountKeys({addressLookupTableAccounts:accounts});
  const programIds=tx.message.compiledInstructions.map(ix=>
   keys.get(ix.programIdIndex)?.toBase58()??'');
  if(programIds.some(p=>!p))return {ok:false,reason:'UNRESOLVED_PROGRAM_INDEX'};
  return {ok:true,mode:'INSPECT_ONLY',lookupTableCount:lookups.length,
   accountCount:keys.length,programIds,
   unknownPrograms:[...new Set(programIds.filter(p=>!knownPrograms.has(p)))]};
 }catch{return {ok:false,reason:'LOOKUP_ACCOUNT_RESOLUTION_FAILED'};}
}
export const ECHO_LOOKUP_INSPECTION_GRANTS_SIGNING=false as const;
