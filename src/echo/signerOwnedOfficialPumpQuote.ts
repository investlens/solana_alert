/** Official-SDK signer-owned two-hop PumpSwap quote and instruction audit.
 * The SDK adapter MUST come from the pinned @pump-fun/pump-sdk/swap package
 * inside the isolated service; accepts no caller- or Telegram-provided quote.
 *
 * This code does not assume a verified CPI ceiling, fresh USD oracle, or
 * Phantom SELL route, so even success is diagnostic/non-executable.
 */
import {createHash} from 'node:crypto';
import {PublicKey,TransactionInstruction,TransactionMessage,
 VersionedTransaction,SystemProgram,type AccountInfo} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {PUMP_SWAP_PROGRAM_ID} from './signerOwnedPumpPoolEvidence.js';
const WSOL='So11111111111111111111111111111111111111112';
const AMM=new PublicKey(PUMP_SWAP_PROGRAM_ID);
const allowed=new Set([
 PUMP_SWAP_PROGRAM_ID,SystemProgram.programId.toBase58(),
 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
 'ComputeBudget111111111111111111111111111111'
]);
export const ECHO_OFFICIAL_PUMP_QUOTE_CAN_SIGN=false as const;
export const ECHO_OFFICIAL_PUMP_QUOTE_CAN_BROADCAST=false as const;
const decimal=/^[1-9][0-9]{0,17}$/;

type Pool={baseMint:PublicKey;quoteMint:PublicKey;isMayhemMode:boolean};
type Snapshot={hops:unknown[];globalConfig:unknown;feeConfig:unknown};
export type EchoOfficialPumpSdkAdapter={
 /** Wraps official OnlinePumpAmmSdk.multiHopPoolHops. */
 multiHopPoolHops(pools:PublicKey[]):Promise<Snapshot>;
 /** Wraps PUMP_AMM_SDK.decodePool on raw independently fetched accounts. */
 decodePool(info:AccountInfo<Buffer>):Pool;
 /** Wraps multiHopSwapQuote; quantity must be official BN type. */
 quote(input:{inMint:PublicKey;hops:unknown[];amountIn:unknown;
  slippage:number;globalConfig:unknown;feeConfig:unknown}):
  {minAmountOut:{toString():string};amountOut?:{toString():string};
   outputAmount?:{toString():string}};
 swapInstructions(input:{user:PublicKey;inMint:PublicKey;
  venues:unknown[];amountIn:unknown;minAmountOut:unknown;
  globalConfig:unknown}):Promise<TransactionInstruction[]>;
 amount(value:string):unknown;
};
export type EchoOfficialPumpQuoteRpc={
 getMultipleAccountsInfo(keys:PublicKey[],commitment:'confirmed'):
  Promise<(AccountInfo<Buffer>|null)[]>;
 getFeeForMessage(message:VersionedTransaction['message'],commitment:'confirmed'):
  Promise<{context:{slot:number};value:number|null}>;
};
export type EchoOwnedPumpQuoteResult={
 ok:true;mode:'SIGNER_OWNED_OFFICIAL_PUMP_QUOTE_ONLY';
 unsignedSha256:string;quotedOutputRaw:string;minOutputRaw:string;
 principalLamports:string;networkFeeLamports:string;
 poolMintContinuityVerified:true;officialInstructionsVerified:true;
 cpiAndRentFullyAudited:false;manualPhantomSellVerified:false;
 signingAllowed:false;broadcastAllowed:false;
}|{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false};
const deny=(reason:string):EchoOwnedPumpQuoteResult=>({
 ok:false,reason,signingAllowed:false,broadcastAllowed:false
});

export async function inspectSignerOwnedOfficialPumpQuote(input:{
 rpc:EchoOfficialPumpQuoteRpc;
 sdk:EchoOfficialPumpSdkAdapter;
 unsignedBytes:Uint8Array;
 expectedUnsignedSha256:string;
 firstPool:string;secondPool:string;
 intermediateMint:string;targetMint:string;
 principalLamports:string;
 slippageBps:number;
}):Promise<EchoOwnedPumpQuoteResult>{
 if(!decimal.test(input.principalLamports)||
    BigInt(input.principalLamports)>100_000_000n||
    !Number.isSafeInteger(input.slippageBps)||
    input.slippageBps<1||input.slippageBps>1000||
    input.unsignedBytes.length<80||input.unsignedBytes.length>3072||
    !/^[0-9a-f]{64}$/.test(input.expectedUnsignedSha256))
  return deny('INVALID_SIGNER_QUOTE_INPUT');
 const sha=createHash('sha256').update(input.unsignedBytes).digest('hex');
 if(sha!==input.expectedUnsignedSha256)return deny('EXACT_UNSIGNED_HASH_CHANGED');
 let tx:VersionedTransaction,first:PublicKey,second:PublicKey,
  intermediate:PublicKey,target:PublicKey;
 try{
  tx=VersionedTransaction.deserialize(input.unsignedBytes);
  first=new PublicKey(input.firstPool);second=new PublicKey(input.secondPool);
  intermediate=new PublicKey(input.intermediateMint);
  target=new PublicKey(input.targetMint);
 }catch{return deny('INVALID_PUMP_ROUTE_IDENTIFIERS');}
 if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
    tx.message.header.numRequiredSignatures!==1||
    tx.signatures.length!==1||tx.signatures[0].some(b=>b!==0)||
    tx.message.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET||
    first.equals(second)||intermediate.equals(target)||
    intermediate.toBase58()===WSOL||target.toBase58()===WSOL)
  return deny('INVALID_EXACT_SIGNER_OR_ROUTE');
 try{
  const infos=await input.rpc.getMultipleAccountsInfo([first,second],'confirmed');
  if(infos.length!==2||infos.some(x=>!x||!x.owner.equals(AMM)||
     x.executable||x.data.length<64))
   return deny('UNTRUSTED_OFFICIAL_POOL_ACCOUNT_OWNER');
  const a=input.sdk.decodePool(infos[0]!);
  const b=input.sdk.decodePool(infos[1]!);
  if(!a.baseMint.equals(intermediate)||
     a.quoteMint.toBase58()!==WSOL||
     !b.baseMint.equals(target)||!b.quoteMint.equals(intermediate)||
     a.isMayhemMode||b.isMayhemMode)
   return deny('POOL_MINT_CONTINUITY_OR_MAYHEM_UNVERIFIED');
  const snapshot=await input.sdk.multiHopPoolHops([first,second]);
  if(!Array.isArray(snapshot.hops)||snapshot.hops.length!==2||
     !snapshot.globalConfig||!snapshot.feeConfig)
   return deny('OFFICIAL_POOL_HOPS_OR_FEE_CONFIG_MISSING');
  const amount=input.sdk.amount(input.principalLamports);
  const quote=input.sdk.quote({
   inMint:new PublicKey(WSOL),hops:snapshot.hops,
   amountIn:amount,slippage:input.slippageBps/100,
   globalConfig:snapshot.globalConfig,feeConfig:snapshot.feeConfig});
  const min=quote?.minAmountOut?.toString();
  const out=(quote?.amountOut??quote?.outputAmount)?.toString();
  if(!min||!out||!decimal.test(min)||!decimal.test(out)||
     BigInt(min)>BigInt(out))
   return deny('OFFICIAL_MIN_OUTPUT_QUOTE_INVALID');
  const instructions=await input.sdk.swapInstructions({
   user:new PublicKey(ECHO_EXPECTED_EXECUTION_WALLET),
   inMint:new PublicKey(WSOL),venues:snapshot.hops,
   amountIn:amount,minAmountOut:quote.minAmountOut,
   globalConfig:snapshot.globalConfig});
  if(!Array.isArray(instructions)||instructions.length<1||
     instructions.length>16||
     instructions.filter(ix=>ix.programId.equals(AMM)).length!==1||
     instructions.some(ix=>!allowed.has(ix.programId.toBase58())))
   return deny('UNREVIEWED_OFFICIAL_SWAP_INSTRUCTIONS');
  let amountTransferred=0n,transfers=0;
  for(const ix of instructions){
   if(!ix.programId.equals(SystemProgram.programId))continue;
   const raw=Buffer.from(ix.data);
   if(raw.length!==12||raw.readUInt32LE(0)!==2||
      ix.keys.length!==2||
      ix.keys[0].pubkey.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET)
    return deny('UNREVIEWED_PAYER_SYSTEM_INSTRUCTION');
   amountTransferred+=raw.readBigUInt64LE(4);transfers++;
  }
  if(transfers!==1||amountTransferred!==BigInt(input.principalLamports))
   return deny('WRONG_OFFICIAL_SWAP_PRINCIPAL');
  const compiled=tx.message;
  const exactAccounts=compiled.staticAccountKeys.map(k=>k.toBase58());
  const pumpIndex=exactAccounts.indexOf(PUMP_SWAP_PROGRAM_ID);
  const swap=compiled.compiledInstructions.filter(ix=>ix.programIdIndex===pumpIndex);
  if(swap.length!==1)return deny('MISSING_EXACT_PUMPSWAP_INSTRUCTION');
  const referenced=new Set(Array.from(swap[0].accountKeyIndexes)
   .map(i=>exactAccounts[i]));
  if(![input.firstPool,input.secondPool,input.intermediateMint,
      input.targetMint].every(address=>referenced.has(address)))
   return deny('VERIFIED_POOLS_NOT_BOUND_TO_EXACT_SWAP_INSTRUCTION');
  const rebuilt=new VersionedTransaction(new TransactionMessage({
   payerKey:new PublicKey(ECHO_EXPECTED_EXECUTION_WALLET),
   recentBlockhash:tx.message.recentBlockhash,
   instructions}).compileToV0Message());
  const rebuiltHash=createHash('sha256').update(rebuilt.serialize()).digest('hex');
  if(rebuiltHash!==sha){
   // Do NOT weaken exact-byte matching. Classify safe structural drift
   // without exporting instructions, account keys, amounts or message bytes.
   // Fresh independent RPC fee/pool state can change SDK quote inputs,
   // and SDK instructions may include nondeterministic created accounts.
   const expected=tx.message,actual=rebuilt.message;
   const originalKeys=expected.staticAccountKeys.map(k=>k.toBase58());
   const recreatedKeys=actual.staticAccountKeys.map(k=>k.toBase58());
   if(expected.recentBlockhash!==actual.recentBlockhash)
    return deny('OFFICIAL_REBUILD_BLOCKHASH_DIFFERED');
   if(originalKeys.length!==recreatedKeys.length||
      originalKeys.some((k,i)=>k!==recreatedKeys[i]))
    return deny('OFFICIAL_REBUILD_ACCOUNT_KEYS_DIFFERED');
   const oldIxs=expected.compiledInstructions,newIxs=actual.compiledInstructions;
   if(oldIxs.length!==newIxs.length)
    return deny('OFFICIAL_REBUILD_INSTRUCTION_COUNT_DIFFERED');
   const changed=oldIxs.some((ix,i)=>{
    const other=newIxs[i];
    return ix.programIdIndex!==other.programIdIndex||
     Buffer.compare(Buffer.from(ix.accountKeyIndexes),
       Buffer.from(other.accountKeyIndexes))!==0||
     Buffer.compare(Buffer.from(ix.data),Buffer.from(other.data))!==0;
   });
   if(changed)return deny('OFFICIAL_REBUILD_INSTRUCTION_DATA_DIFFERED');
   return deny('OFFICIAL_REBUILT_MESSAGE_DIFFERS_FROM_SIGNER_REQUEST');
  }
  const fee=await input.rpc.getFeeForMessage(tx.message,'confirmed');
  if(!Number.isSafeInteger(fee.context?.slot)||fee.context.slot<=0||
     !Number.isSafeInteger(fee.value)||fee.value===null||fee.value<=0)
   return deny('UNVERIFIED_MESSAGE_NETWORK_FEE');
  return {ok:true,mode:'SIGNER_OWNED_OFFICIAL_PUMP_QUOTE_ONLY',
   unsignedSha256:sha,quotedOutputRaw:out,minOutputRaw:min,
   principalLamports:input.principalLamports,
   networkFeeLamports:String(fee.value),
   poolMintContinuityVerified:true,officialInstructionsVerified:true,
   cpiAndRentFullyAudited:false,manualPhantomSellVerified:false,
   signingAllowed:false,broadcastAllowed:false};
 }catch{return deny('OFFICIAL_SDK_OR_PINNED_RPC_READ_UNAVAILABLE');}
}
