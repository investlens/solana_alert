/** Strictly observational, signer-owned PumpSwap SOL lamport CPI ledger.
 * Decode every System Program transfer/create debit from the exact message
 * and reported simulation inner instructions. Does not trust an arbitrary
 * "CPI verified" boolean; rejects unknown payer-funded operations.
 *
 * IMPORTANT: this only reconciles System-wallet SOL balance movements.
 * It DOES NOT prove token account balances, pool/mint continuity, fee-aware
 * SDK quote, Phantom SELL, or signed transaction correctness. Never execute.
 */
import {createHash} from 'node:crypto';
import {SystemProgram,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_CPI_LEDGER_CAN_SIGN=false as const;
export const ECHO_CPI_LEDGER_CAN_BROADCAST=false as const;
const decimal=(s:string):bigint|null=>
 typeof s==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(s)?BigInt(s):null;
export type EchoCpiRawInnerGroup={
 index:number;
 instructions:{programIdIndex:number;accounts:number[];data:string;
  opaqueParsedNonSystem?:true}[];
};
export type EchoSignerCpiLedger={
 ok:true;mode:'PAYER_LAMPORT_CPI_ONLY';
 unsignedSha256:string;
 observedPayerDeltaLamports:string;
 systemDebitFromPayerLamports:string;
 networkFeeLamports:string;
 conservativeWalletDebitLamports:string;
 programInstructionsReviewed:number;
 tokenEffectsProven:false;poolMintContinuityProven:false;
 manualPhantomSellVerified:false;signingAllowed:false;broadcastAllowed:false;
}|{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false;
 diagnostic?:{
  observedPayerDeltaLamports:string;
  outboundSystemDebitsLamports:string;
  inboundSystemCreditsLamports:string;
  networkFeeLamports:string;
  unexplainedAgainstDebitOnlyLamports:string;
  unexplainedAgainstNetSystemLamports:string;
  programInstructionsReviewed:number;
 }};
const fail=(reason:string,diagnostic?:Extract<EchoSignerCpiLedger,{ok:false}>['diagnostic']):EchoSignerCpiLedger=>({
 ok:false,reason,...(diagnostic?{diagnostic}:{}),
 signingAllowed:false,broadcastAllowed:false
});

export function reconcileEchoSignerPumpCpiLedger(input:{
 unsignedBytes:Uint8Array;
 expectedUnsignedSha256:string;
 prePayerBalanceLamports:string;
 postSimulatedPayerBalanceLamports:string;
 networkFeeLamports:string;
 innerInstructions:readonly EchoCpiRawInnerGroup[]|null;
}):EchoSignerCpiLedger{
 const b=input.unsignedBytes;
 if(b.length<80||b.length>3072||
   !/^[0-9a-f]{64}$/.test(input.expectedUnsignedSha256)||
   createHash('sha256').update(b).digest('hex')!==input.expectedUnsignedSha256)
  return fail('UNBOUND_EXACT_MESSAGE');
 const before=decimal(input.prePayerBalanceLamports);
 const after=decimal(input.postSimulatedPayerBalanceLamports);
 const fee=decimal(input.networkFeeLamports);
 if(before===null||after===null||fee===null||fee===0n||before<=after)
  return fail('UNVERIFIED_WALLET_BALANCE_OR_FEE');
 if(!Array.isArray(input.innerInstructions))
  return fail('MISSING_INDEPENDENT_CPI_TRACE');
 let tx:VersionedTransaction;
 try{tx=VersionedTransaction.deserialize(b);}
 catch{return fail('MALFORMED_UNSIGNED_TRANSACTION');}
 const msg=tx.message;
 if(msg.version!==0||msg.addressTableLookups.length!==0||
   msg.header.numRequiredSignatures!==1||tx.signatures.length!==1||
   tx.signatures[0].some(x=>x!==0)||
   msg.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET)
  return fail('UNTRUSTED_TRANSACTION_SIGNER');
 const keys=msg.staticAccountKeys.map(k=>k.toBase58());
 const systemIndex=keys.indexOf(SystemProgram.programId.toBase58());
 let debits=0n,credits=0n,scanned=0;
 const scan=(programIdIndex:number,accounts:readonly number[],raw:Uint8Array):string|null=>{
  if(!Number.isSafeInteger(programIdIndex)||programIdIndex<0||
     programIdIndex>=keys.length||
     accounts.some(a=>!Number.isSafeInteger(a)||a<0||a>=keys.length))
   return 'INVALID_CPI_ACCOUNT_INDEX';
  scanned++;
  if(scanned>200)return 'EXCESSIVE_CPI_INSTRUCTIONS';
  if(programIdIndex!==systemIndex)return null;
  if(raw.length<4)return 'INVALID_SYSTEM_INSTRUCTION';
  const buffer=Buffer.from(raw);
  const opcode=buffer.readUInt32LE(0);
  const payerIsSource=accounts[0]===0;
  const payerIsDestination=accounts[1]===0;
  if(!payerIsSource&&!payerIsDestination)return null;
  // SystemProgram Transfer (2) or CreateAccount (0), each has a fixed
  // instruction shape and debits account index 0 (the sealed fee payer).
  if(!((opcode===2&&buffer.length===12&&accounts.length===2)||
       (opcode===0&&buffer.length===52&&accounts.length===2)))
   return 'UNKNOWN_SYSTEM_PAYER_OPERATION';
  if(payerIsSource&&payerIsDestination)
   return 'PAYER_SELF_TRANSFER_NOT_A_VALID_BUY_DEBIT';
  // Track System credits separately for discrepancy diagnostics; never
  // silently net them into an approved debit or certify token closes.
  if(payerIsSource)debits+=buffer.readBigUInt64LE(4);
  else if(opcode===2&&payerIsDestination)
   credits+=buffer.readBigUInt64LE(4);
  else return 'UNKNOWN_SYSTEM_PAYER_CREDIT';
  if(debits>1_000_000_000n||credits>1_000_000_000n)
   return 'UNBOUNDED_SYSTEM_WALLET_MOVEMENT';
  return null;
 };
 for(const ix of msg.compiledInstructions){
  const error=scan(ix.programIdIndex,Array.from(ix.accountKeyIndexes),ix.data);
  if(error)return fail(error);
 }
 const seen=new Set<number>();
 for(const group of input.innerInstructions){
  if(!group||!Number.isSafeInteger(group.index)||group.index<0||
    group.index>=msg.compiledInstructions.length||seen.has(group.index)||
    !Array.isArray(group.instructions))
   return fail('INVALID_CPI_GROUP');
  seen.add(group.index);
  for(const ix of group.instructions){
   // JSON-parsed non-System token/ATA/AMM CPI has no original binary data.
   // Explicitly record that limitation rather than forge instruction bytes.
   // This result only attests payer System debits, never token effects.
   if(ix?.opaqueParsedNonSystem===true){
    const id=keys[ix.programIdIndex];
    if(![
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
    ].includes(id)||ix.accounts.length!==0||ix.data!=='')
     return fail('UNTRUSTED_OPAQUE_PARSED_CPI');
    scanned++;
    if(scanned>200)return fail('EXCESSIVE_CPI_INSTRUCTIONS');
    continue;
   }
   if(!ix||typeof ix.data!=='string'||ix.data.length>4096||
     !/^[1-9A-HJ-NP-Za-km-z]+$/.test(ix.data)||
     !Array.isArray(ix.accounts))
    return fail('INVALID_CPI_INSTRUCTION');
   let raw:Uint8Array;
   try{raw=bs58.decode(ix.data);}catch{return fail('INVALID_CPI_BASE58_DATA');}
   const error=scan(ix.programIdIndex,ix.accounts,raw);
   if(error)return fail(error);
  }
 }
 const delta=before-after;
 // Solana RPC versions differ on including network fee in simulated
 // payer snapshot. Accept only the two explicit, comprehensible cases.
 if(delta!==debits-credits&&delta!==debits-credits+fee){
  // A non-System refund (e.g. SPL Token CloseAccount) can explain why a
  // post-simulation payer snapshot moves less than the System debit sum.
  // It is NOT safe to infer such a refund from the gap. Keep blocking and
  // expose only bounded public lamport totals for the next audit.
  return fail('UNEXPLAINED_PAYER_LAMPORT_BALANCE_CHANGE',{
   observedPayerDeltaLamports:String(delta),
   outboundSystemDebitsLamports:String(debits),
   inboundSystemCreditsLamports:String(credits),
   networkFeeLamports:String(fee),
   unexplainedAgainstDebitOnlyLamports:String(delta-debits),
   unexplainedAgainstNetSystemLamports:String(delta-(debits-credits)),
   programInstructionsReviewed:scanned
  });
 }
 const upper=debits+fee;
 return {ok:true,mode:'PAYER_LAMPORT_CPI_ONLY',
  unsignedSha256:input.expectedUnsignedSha256,
  observedPayerDeltaLamports:String(delta),
  systemDebitFromPayerLamports:String(debits),
  networkFeeLamports:String(fee),
  conservativeWalletDebitLamports:String(upper),
  programInstructionsReviewed:scanned,
  tokenEffectsProven:false,poolMintContinuityProven:false,
  manualPhantomSellVerified:false,
  signingAllowed:false,broadcastAllowed:false};
}
