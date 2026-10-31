/** Deterministic, read-only inspection of a Jupiter v0 unsigned order.
 * This audit NEVER authorizes signing or broadcasting. It deliberately rejects
 * address lookup tables and unknown programs until every resolved account,
 * fee, token destination and swap instruction has independent verification.
 */
import {VersionedTransaction,PublicKey,ComputeBudgetProgram,SystemProgram} from '@solana/web3.js';
import {createHash} from 'node:crypto';

const JUPITER='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const allowed=new Set([
 ComputeBudgetProgram.programId.toBase58(),SystemProgram.programId.toBase58(),
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFCE7uFyV9QnF4jrb',
 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',JUPITER
]);
const MAX_COMPUTE_UNITS=1_400_000;
const MAX_MICROLAMPORTS_PER_UNIT=2_000_000n;
const MAX_PRIORITY_LAMPORTS=3_000_000n;
export type EchoUnsignedAudit={
 sha256:string;feePayer:string;staticAccounts:string[];
 writableAccounts:string[];programs:string[];lookupTables:number;requiredSignatures:number;
 computeUnitLimit:number|null;computeUnitPriceMicroLamports:string|null;
 worstCasePriorityFeeLamports:string|null;feeEstimateComplete:boolean;signingApproved:false;
};
export type EchoUnsignedAuditResult={ok:true,audit:EchoUnsignedAudit}|{ok:false,reason:string};
export function auditEchoUnsignedSwap(base64:string,expectedFeePayer:string):EchoUnsignedAuditResult{
 const fail=(reason:string):EchoUnsignedAuditResult=>({ok:false,reason});
 if(typeof base64!=='string'||base64.length<100||base64.length>3000||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))return fail('INVALID_UNSIGNED_ENCODING');
 let bytes:Buffer,tx:VersionedTransaction;
 try{
   bytes=Buffer.from(base64,'base64');
   if(bytes.toString('base64')!==base64)return fail('INVALID_UNSIGNED_ENCODING');
   tx=VersionedTransaction.deserialize(bytes);
 }catch{return fail('INVALID_UNSIGNED_TRANSACTION');}
 let payer:string;
 try{payer=new PublicKey(expectedFeePayer).toBase58();}catch{return fail('INVALID_EXPECTED_PAYER');}
 const msg=tx.message;
 if(msg.version!==0||msg.addressTableLookups.length>0)return fail('UNRESOLVED_LOOKUP_TABLES');
 if(msg.header.numRequiredSignatures!==1||tx.signatures.length!==1||
    !tx.signatures[0].every(v=>v===0))return fail('UNTRUSTED_SIGNERS');
 const keys=msg.staticAccountKeys.map(k=>k.toBase58());
 if(keys[0]!==payer)return fail('UNEXPECTED_FEE_PAYER');
 const writable:string[]=[];
 for(let i=0;i<keys.length;i++)if(msg.isAccountWritable(i))writable.push(keys[i]);
 let limit:number|null=null,price:bigint|null=null,swapCount=0;
 const programs:string[]=[];
 for(const ix of msg.compiledInstructions){
   if(ix.programIdIndex>=keys.length||ix.accountKeyIndexes.some(j=>j>=keys.length))
     return fail('INVALID_ACCOUNT_INDEX');
   const program=keys[ix.programIdIndex];
   if(!allowed.has(program))return fail('UNREVIEWED_PROGRAM');
   if(!programs.includes(program))programs.push(program);
   if(program===JUPITER)swapCount++;
   if(program===SystemProgram.programId.toBase58()){
     if(ix.data.length<4)return fail('UNREVIEWED_SYSTEM_INSTRUCTION');
     const discriminator=Buffer.from(ix.data).readUInt32LE(0);
     if(discriminator===2)return fail('UNREVIEWED_SOL_TRANSFER');
   }
   if(program===ComputeBudgetProgram.programId.toBase58()){
     const data=Buffer.from(ix.data),kind=data[0];
     if(kind===2){
       if(limit!==null||data.length!==5)return fail('UNREVIEWED_COMPUTE_BUDGET');
       limit=data.readUInt32LE(1);
       if(limit<1||limit>MAX_COMPUTE_UNITS)return fail('COMPUTE_LIMIT_EXCEEDED');
     }else if(kind===3){
       if(price!==null||data.length!==9)return fail('UNREVIEWED_COMPUTE_BUDGET');
       price=data.readBigUInt64LE(1);
       if(price>MAX_MICROLAMPORTS_PER_UNIT)return fail('PRIORITY_PRICE_EXCEEDED');
     }else return fail('UNREVIEWED_COMPUTE_BUDGET');
   }
 }
 if(swapCount!==1)return fail('NO_UNIQUE_JUPITER_SWAP');
 const worstCase=limit!==null&&price!==null?
  (BigInt(limit)*price+999_999n)/1_000_000n:null;
 if(worstCase!==null&&worstCase>MAX_PRIORITY_LAMPORTS)return fail('PRIORITY_FEE_EXCEEDED');
 return {ok:true,audit:{
  sha256:createHash('sha256').update(bytes).digest('hex'),feePayer:payer,
  staticAccounts:keys,writableAccounts:writable,programs,lookupTables:0,
  requiredSignatures:1,computeUnitLimit:limit,
  computeUnitPriceMicroLamports:price?.toString()??null,
  worstCasePriorityFeeLamports:worstCase?.toString()??null,
  feeEstimateComplete:limit!==null&&price!==null,
  signingApproved:false
 }};
}
