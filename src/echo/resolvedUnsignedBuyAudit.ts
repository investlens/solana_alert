/** Strict, read-only unsigned BUY destination and route safety audit.
 * Never approves signing: external programs can have dynamic CPI / fee behavior.
 * Resolved v0 account keys + independent RPC account state are required.
 * Do not claim that instructions, signer ownership or ALT resolution alone
 * prove a swap's eventual output balance.
 */
import {AddressLookupTableAccount,PublicKey,VersionedTransaction,
  ComputeBudgetProgram,SystemProgram} from '@solana/web3.js';
import type {EchoLookupTableProvider} from './readOnlyAddressLookupInspection.js';

export const ECHO_RESOLVED_BUY_ROUTE_GRANTS_SIGNING=false as const;
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022='TokenzQdBNbLqP5VEhdkAS6EPFCE7uFyV9QnF4jrb';
const ATA='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MAX_LOOKUPS=4,MAX_KEYS=128,MAX_INSTRUCTIONS=40;
const MAX_PRIORITY_LAMPORTS=500_000n;
const MAX_UNITS=1_400_000;
const ACTIVE=18446744073709551615n;
const KNOWN=new Set([TOKEN,TOKEN_2022,ATA,
 ComputeBudgetProgram.programId.toBase58(),SystemProgram.programId.toBase58(),
 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4']);
export interface EchoAccountStateProvider{
 getAccounts(addresses:readonly PublicKey[]):Promise<(Readonly<{owner:PublicKey;data:Uint8Array;executable:boolean}>|null)[]>;
}
export type EchoResolvedBuyAudit=
 |{ok:true;mode:'AUDIT_ONLY';signingApproved:false;
   unsignedSha256:string;lookupTables:number;resolvedAccounts:number;
   writableAccounts:string[];invokedPrograms:string[];unreviewedPrograms:string[];
   destinationTokenAccount:string;destinationOwnerVerified:true;mintVerified:true;
   accountStateReads:number;lookupReads:number;priorityFeeLamports:string;
   directSolTransfers:0;unsupportedInstructions:string[];
   /** Program side effects and token balance deltas require separate proof. */
   economicOutcomeVerified:false}
 |{ok:false;reason:string;signingApproved:false;lookupReads?:number;accountStateReads?:number};
const deny=(reason:string,lookupReads=0,accountStateReads=0):EchoResolvedBuyAudit=>
 ({ok:false,reason,signingApproved:false,lookupReads,accountStateReads});
export async function auditEchoResolvedUnsignedBuy(input:{
 base64:string;wallet:string;mint:string;lookupProvider:EchoLookupTableProvider;
 accountProvider:EchoAccountStateProvider;
}):Promise<EchoResolvedBuyAudit>{
 const {createHash}=await import('node:crypto');
 let tx:VersionedTransaction,expectedWallet:PublicKey,expectedMint:PublicKey;
 try{
  expectedWallet=new PublicKey(input.wallet);expectedMint=new PublicKey(input.mint);
  if(expectedWallet.toBase58()!==input.wallet||expectedMint.toBase58()!==input.mint||
   !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)||
   input.base64.length<100||input.base64.length>4096)return deny('INVALID_AUDIT_INPUT');
  const bytes=Buffer.from(input.base64,'base64');
  if(bytes.toString('base64')!==input.base64)return deny('INVALID_UNSIGNED_BYTES');
  tx=VersionedTransaction.deserialize(bytes);
 }catch{return deny('INVALID_UNSIGNED_BYTES');}
 const msg=tx.message;
 if(msg.version!==0||msg.header.numRequiredSignatures!==1||tx.signatures.length!==1||
    !tx.signatures[0].every(x=>x===0)||msg.staticAccountKeys[0]?.toBase58()!==input.wallet)
   return deny('UNTRUSTED_SIGNER_OR_FEE_PAYER');
 if(msg.addressTableLookups.length>MAX_LOOKUPS||
    msg.compiledInstructions.length>MAX_INSTRUCTIONS)return deny('TRANSACTION_TOO_COMPLEX');
 const tables:AddressLookupTableAccount[]=[];
 const seen=new Set<string>();
 let lookupReads=0;
 for(const ref of msg.addressTableLookups){
  const key=ref.accountKey.toBase58();
  if(seen.has(key))return deny('DUPLICATE_LOOKUP_TABLE',lookupReads);
  seen.add(key);
  let table:AddressLookupTableAccount|null;
  try{lookupReads++;table=await input.lookupProvider.lookup(ref.accountKey);}
  catch{return deny('LOOKUP_RPC_UNAVAILABLE',lookupReads);}
  if(!table||!table.key.equals(ref.accountKey))return deny('LOOKUP_TABLE_MISSING',lookupReads);
  if(table.state.deactivationSlot!==ACTIVE)return deny('LOOKUP_TABLE_DEACTIVATED',lookupReads);
  if([...ref.readonlyIndexes,...ref.writableIndexes].some(i=>i>=table!.state.addresses.length))
    return deny('LOOKUP_INDEX_OUT_OF_BOUNDS',lookupReads);
  // A table that was extended recently needs a current-slot freshness check
  // before signing; never assume immutable account data.
  tables.push(table);
 }
 let keys:ReturnType<typeof msg.getAccountKeys>;
 try{keys=msg.getAccountKeys({addressLookupTableAccounts:tables});}
 catch{return deny('ACCOUNT_RESOLUTION_FAILED',lookupReads);}
 if(keys.length>MAX_KEYS)return deny('ACCOUNT_SET_TOO_LARGE',lookupReads);
 const all=Array.from({length:keys.length},(_,i)=>keys.get(i)?.toBase58()??'');
 if(all.some(v=>!v)||new Set(all).size!==all.length)
  return deny('DUPLICATE_OR_UNRESOLVED_ACCOUNT',lookupReads);
 const writable=all.filter((_,i)=>msg.isAccountWritable(i));
 const programs:string[]=[];
 let limit:number|null=null,price:bigint|null=null;
 const unsupported:string[]=[];
 for(const ix of msg.compiledInstructions){
  if(ix.programIdIndex>=all.length||ix.accountKeyIndexes.some(i=>i>=all.length))
    return deny('INVALID_INSTRUCTION_ACCOUNT_INDEX',lookupReads);
  const program=all[ix.programIdIndex];
  if(msg.isAccountWritable(ix.programIdIndex))return deny('WRITABLE_EXECUTABLE_PROGRAM',lookupReads);
  programs.push(program);
  const data=Buffer.from(ix.data);
  if(program===SystemProgram.programId.toBase58()){
    if(data.length<4)return deny('UNKNOWN_SYSTEM_INSTRUCTION',lookupReads);
    // Transfer, create account, nonce and allocate calls require a fully
    // reconstructed payer debit/rent model; never approve implicitly.
    unsupported.push('SYSTEM_'+data.readUInt32LE(0));
  }else if(program===ComputeBudgetProgram.programId.toBase58()){
    if(data[0]===2&&data.length===5&&limit===null)limit=data.readUInt32LE(1);
    else if(data[0]===3&&data.length===9&&price===null)price=data.readBigUInt64LE(1);
    else return deny('UNKNOWN_OR_DUPLICATE_COMPUTE_BUDGET',lookupReads);
  }else if(program===TOKEN||program===TOKEN_2022){
    // Token SetAuthority / CloseAccount / Approve / transfer etc can change
    // ownership or spend tokens: require separate deterministic instruction audit.
    unsupported.push('TOKEN_INSTRUCTION_REQUIRES_SEMANTIC_AUDIT');
  }else if(program===ATA){
    if(data.length>1||data.length===1&&data[0]!==1)
      return deny('UNKNOWN_ATA_INSTRUCTION',lookupReads);
  }
 }
 if(limit===null||price===null||limit<1||limit>MAX_UNITS)
  return deny('COMPUTE_BUDGET_UNVERIFIED',lookupReads);
 const fee=(BigInt(limit)*price+999_999n)/1_000_000n;
 if(fee>MAX_PRIORITY_LAMPORTS)return deny('PRIORITY_FEE_OVER_CAP',lookupReads);
 // Read the mint only. The output token account may not yet exist and will
 // be created as an ATA by the route. One bounded batch request.
 let accountStateReads=0;
 let mintState:Readonly<{owner:PublicKey;data:Uint8Array;executable:boolean}>|null;
 try{
  accountStateReads++;
  const result=await input.accountProvider.getAccounts([expectedMint]);
  if(!Array.isArray(result)||result.length!==1)return deny('INVALID_ACCOUNT_STATE_RESPONSE',lookupReads,accountStateReads);
  mintState=result[0];
 }catch{return deny('ACCOUNT_STATE_UNAVAILABLE',lookupReads,accountStateReads);}
 if(!mintState||mintState.executable||![TOKEN,TOKEN_2022].includes(mintState.owner.toBase58())||
    mintState.data.length<82)return deny('UNVERIFIED_MINT_ACCOUNT',lookupReads,accountStateReads);
 const tokenProgram=mintState.owner;
 const [destination]=PublicKey.findProgramAddressSync(
  [expectedWallet.toBuffer(),tokenProgram.toBuffer(),expectedMint.toBuffer()],new PublicKey(ATA));
 if(!writable.includes(destination.toBase58()))
  return deny('WALLET_TOKEN_DESTINATION_NOT_WRITABLE',lookupReads,accountStateReads);
 const unreviewed=[...new Set(programs.filter(p=>!KNOWN.has(p)))];
 if(!programs.some(p=>p!==ComputeBudgetProgram.programId.toBase58()&&p!==ATA))
  return deny('NO_SWAP_PROGRAM',lookupReads,accountStateReads);
 return {
  ok:true,mode:'AUDIT_ONLY',signingApproved:false,
  unsignedSha256:createHash('sha256').update(Buffer.from(input.base64,'base64')).digest('hex'),
  lookupTables:tables.length,resolvedAccounts:all.length,writableAccounts:writable,
  invokedPrograms:programs,unreviewedPrograms:unreviewed,
  destinationTokenAccount:destination.toBase58(),
  destinationOwnerVerified:true,mintVerified:true,
  lookupReads,accountStateReads,priorityFeeLamports:String(fee),
  directSolTransfers:0,unsupportedInstructions:unsupported,
  economicOutcomeVerified:false
 };
}
