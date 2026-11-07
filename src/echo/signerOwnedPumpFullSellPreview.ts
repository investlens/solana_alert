/** Signer-owned, read-only PumpSwap SELL route proof.
 * Build an actual SDK token->SOL unsigned swap for a token balance and
 * independently estimate the exact message network fee from pinned RPC.
 * This is a wallet-compatible transaction SHAPE, not an executed Phantom
 * app sale and not a full independent CPI/rent/exit reserve ceiling.
 */
import {createHash} from 'node:crypto';
import {PublicKey,VersionedTransaction,TransactionMessage,SystemProgram}
 from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {PUMP_SWAP_PROGRAM_ID} from './signerOwnedPumpPoolEvidence.js';
import type {EchoOfficialPumpSdkAdapter} from './signerOwnedOfficialPumpQuote.js';
export const ECHO_PUMP_SELL_PREVIEW_CAN_SIGN=false as const;
export const ECHO_PUMP_SELL_PREVIEW_CAN_BROADCAST=false as const;
const allowed=new Set([
 PUMP_SWAP_PROGRAM_ID,SystemProgram.programId.toBase58(),
 'ComputeBudget111111111111111111111111111111',
 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);
const WSOL='So11111111111111111111111111111111111111112';
const natural=/^[1-9][0-9]{0,17}$/;
export type EchoSellPreviewRpc={
 getLatestBlockhash(commitment:'confirmed'):Promise<{blockhash:string}>;
 getFeeForMessage(message:VersionedTransaction['message'],
  commitment:'confirmed'):Promise<{context:{slot:number};value:number|null}>;
};
export type EchoSellPreviewResult=
 |{ok:true;mode:'PUMPSWAP_UNSIGNED_FULL_BALANCE_SELL_PREVIEW';
  unsignedSha256:string;quotedSolOutputLamports:string;
  minimumSolOutputLamports:string;networkFeeLamports:string;
  tokenInputRaw:string;targetMint:string;
  fullRentCpiAndPhantomAppVerified:false;
  canSign:false;canBroadcast:false}
 |{ok:false;reason:string;canSign:false;canBroadcast:false};
const reject=(reason:string):EchoSellPreviewResult=>({
 ok:false,reason,canSign:false,canBroadcast:false
});
export async function previewEchoPumpFullSell(input:{
 sdk:EchoOfficialPumpSdkAdapter;rpc:EchoSellPreviewRpc;
 targetMint:string;firstPool:string;secondPool:string;
 /** Exact balance independently observed from dedicated wallet's token ATA. */
 verifiedFullWalletTokenBalanceRaw:string;
 slippageBps:number;
}):Promise<EchoSellPreviewResult>{
 if(!natural.test(input.verifiedFullWalletTokenBalanceRaw)||
    !Number.isSafeInteger(input.slippageBps)||
    input.slippageBps<1||input.slippageBps>1000)
  return reject('INVALID_FULL_SELL_INPUT_OR_SLIPPAGE');
 try{
  const mint=new PublicKey(input.targetMint);
  const first=new PublicKey(input.firstPool);
  const second=new PublicKey(input.secondPool);
  if(mint.toBase58()===WSOL||first.equals(second))
   return reject('UNTRUSTED_SELL_MINT_OR_POOLS');
  // Reverse the verified BUY route: target -> intermediate -> WSOL.
  const snapshot=await input.sdk.multiHopPoolHops([second,first]);
  if(!Array.isArray(snapshot.hops)||snapshot.hops.length!==2||
     !snapshot.globalConfig||!snapshot.feeConfig)
   return reject('SELL_POOL_AND_FEE_STATE_UNAVAILABLE');
  const amount=input.sdk.amount(input.verifiedFullWalletTokenBalanceRaw);
  const quoted=input.sdk.quote({inMint:mint,hops:snapshot.hops,
   amountIn:amount,slippage:input.slippageBps/100,
   globalConfig:snapshot.globalConfig,feeConfig:snapshot.feeConfig});
  const min=quoted?.minAmountOut?.toString();
  const out=(quoted?.amountOut??quoted?.outputAmount)?.toString();
  if(!min||!out||!natural.test(min)||!natural.test(out)||
     BigInt(min)>BigInt(out))
   return reject('UNVERIFIED_FULL_SELL_SOL_OUTPUT');
  const instructions=await input.sdk.swapInstructions({
   user:new PublicKey(ECHO_EXPECTED_EXECUTION_WALLET),
   inMint:mint,venues:snapshot.hops,amountIn:amount,
   minAmountOut:quoted.minAmountOut,
   globalConfig:snapshot.globalConfig
  });
  if(!Array.isArray(instructions)||instructions.length<1||
     instructions.length>16||
     instructions.filter(x=>x.programId.toBase58()===PUMP_SWAP_PROGRAM_ID).length!==1||
     instructions.some(x=>!allowed.has(x.programId.toBase58())))
   return reject('UNREVIEWED_SELL_SDK_INSTRUCTIONS');
  // Reject any additional unknown native SOL payer transfer on a SELL.
  if(instructions.some(ix=>ix.programId.equals(SystemProgram.programId)&&
     ix.keys[0]?.pubkey.toBase58()===ECHO_EXPECTED_EXECUTION_WALLET))
   return reject('UNKNOWN_SELL_PAYER_SOL_DEBIT');
  const blockhash=await input.rpc.getLatestBlockhash('confirmed');
  const tx=new VersionedTransaction(new TransactionMessage({
   payerKey:new PublicKey(ECHO_EXPECTED_EXECUTION_WALLET),
   recentBlockhash:blockhash.blockhash,instructions
  }).compileToV0Message());
  if(tx.serialize().length>1232)return reject('SELL_TRANSACTION_TOO_LARGE');
  const keys=tx.message.staticAccountKeys.map(k=>k.toBase58());
  const program=keys.indexOf(PUMP_SWAP_PROGRAM_ID);
  const swap=tx.message.compiledInstructions.filter(ix=>ix.programIdIndex===program);
  const members=new Set(Array.from(swap[0]?.accountKeyIndexes??[]).map(i=>keys[i]));
  if(![input.firstPool,input.secondPool,input.targetMint].every(x=>members.has(x)))
   return reject('SELL_POOLS_AND_MINT_NOT_BOUND_TO_SWAP');
  const fee=await input.rpc.getFeeForMessage(tx.message,'confirmed');
  if(!Number.isSafeInteger(fee.context?.slot)||fee.context.slot<=0||
     !Number.isSafeInteger(fee.value)||fee.value===null||fee.value<=0)
   return reject('UNVERIFIED_FULL_SELL_NETWORK_FEE');
  return {ok:true,mode:'PUMPSWAP_UNSIGNED_FULL_BALANCE_SELL_PREVIEW',
   unsignedSha256:createHash('sha256').update(tx.serialize()).digest('hex'),
   quotedSolOutputLamports:out,minimumSolOutputLamports:min,
   networkFeeLamports:String(fee.value),
   tokenInputRaw:input.verifiedFullWalletTokenBalanceRaw,
   targetMint:mint.toBase58(),
   fullRentCpiAndPhantomAppVerified:false,
   canSign:false,canBroadcast:false};
 }catch{return reject('SIGNED_SELL_ROUTE_NOT_AVAILABLE_FROM_PINNED_SDK_OR_RPC');}
}
