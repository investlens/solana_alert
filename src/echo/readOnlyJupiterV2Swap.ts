/** Jupiter Swap API v2 READ-ONLY buy/sell order and RPC simulation.
 * Builds a real unsigned v0 /order transaction for the chosen side. Never signs,
 * calls /execute, /submit, sendTransaction or sends an unsigned transaction.
 * IMPORTANT: simulation success is not economic/route authorization to sign.
 * v0 transactions with lookup tables or extra signers FAIL CLOSED pending a
 * complete, signer-side account/fee audit.
 */
import {VersionedTransaction,PublicKey,ComputeBudgetProgram,SystemProgram} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {simulateEchoUnsignedTransaction} from './readOnlySimulation.js';
import {auditEchoUnsignedSwap,type EchoUnsignedAudit} from './unsignedSwapAudit.js';

export const ECHO_JUPITER_V2_READ_ONLY=true as const;
export const ECHO_JUPITER_V2_EXECUTION_ENABLED=false as const;
const SOL='So11111111111111111111111111111111111111112';
const BASE='https://api.jup.ag/swap/v2/order';
const programs=new Set([
 ComputeBudgetProgram.programId.toBase58(),
 SystemProgram.programId.toBase58(),
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFCE7uFyV9QnF4jrb',
 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
]);
// A read-only quote can never authorize a spend; these are conservative
// screening ceilings, NOT sufficient for production route economics.
const MAX_PREVIEW_PLATFORM_FEE_BPS=100;
const MAX_PREVIEW_INPUT_LAMPORTS=100_000_000;
const validMint=(v:string)=>{try{return new PublicKey(v).toBase58()===v}catch{return false}};
export type EchoJupiterV2PreviewRequest={
 side:'BUY'|'SELL';rpcUrl:string;publicWallet:string;mint:string;
 /** BUY: lamports SOL to spend; SELL: raw token units to sell. */
 amountRaw:string;maxSlippageBps:number;jupiterApiKey:string;
};
export type EchoJupiterV2PreviewResult=
 | {ok:true;reason:'RPC_SIMULATION_SUCCEEDED';side:'BUY'|'SELL';
    inputMint:string;outputMint:string;inputRaw:string;quotedOutputRaw:string;
    unsignedTransactionSha256:string;requestId:string;logs:string[];unsignedAudit?:EchoUnsignedAudit}
 | {ok:false;reason:string;failureClass?:string;orderBuilt?:boolean;unsignedTransactionSha256?:string;builderErrorCode?:number;builderRouter?:string};
export async function readOnlyEchoJupiterV2Swap(
 r:EchoJupiterV2PreviewRequest,fetcher:typeof fetch=fetch
):Promise<EchoJupiterV2PreviewResult>{
 if(!validMint(r.mint)||r.mint===SOL||!validMint(r.publicWallet)||
    !/^[1-9][0-9]*$/.test(r.amountRaw)||r.amountRaw.length>18||
    !Number.isSafeInteger(Number(r.amountRaw))||
    (r.side==='BUY'&&Number(r.amountRaw)>MAX_PREVIEW_INPUT_LAMPORTS)||
    !Number.isSafeInteger(r.maxSlippageBps)||r.maxSlippageBps<1||
    r.maxSlippageBps>300)
  return {ok:false,reason:'INVALID_PREVIEW_REQUEST'};
 const inputMint=r.side==='BUY'?SOL:r.mint;
 const outputMint=r.side==='BUY'?r.mint:SOL;
 try{
  const url=new URL(BASE);
  url.searchParams.set('inputMint',inputMint);
  url.searchParams.set('outputMint',outputMint);
  url.searchParams.set('amount',r.amountRaw);
  url.searchParams.set('taker',r.publicWallet);
  url.searchParams.set('slippageBps',String(r.maxSlippageBps));
  url.searchParams.set('maxSupportedTransactionVersion','0');
  const response=await fetcher(url.toString(),{
   method:'GET',headers:r.jupiterApiKey?.trim()?{'x-api-key':r.jupiterApiKey.trim(),accept:'application/json'}:{accept:'application/json'},
   signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)return {ok:false,reason:
   response.status===401||response.status===403?'JUPITER_API_AUTH_REJECTED':
   response.status===429?'JUPITER_RATE_LIMITED':'JUPITER_ORDER_UNAVAILABLE'};
  const order=await response.json();
  // Jupiter /order may omit optional quote metadata. Do not falsely report
  // a broken route for a missing field, and never turn this into sign approval.
  if(order.errorCode!==undefined){
    const router=['metis','jupiterz','dflow','okx'].includes(order.router)?order.router:undefined;
    const code=Number.isSafeInteger(order.errorCode)?order.errorCode:undefined;
    const failureClass=code===1&&router?'INSUFFICIENT_FUNDS_OR_TOKENS':
      code===2&&router==='jupiterz'?'MISSING_TOKEN_ACCOUNT':
      code===2&&router?'INSUFFICIENT_SOL_FOR_GAS':
      code===3&&router==='jupiterz'?'QUOTE_TRANSACTION_BUILD_FAILED':
      code===3&&router?'BELOW_GASLESS_MINIMUM':'JUPITER_BUILD_ERROR_UNKNOWN';
    return {ok:false,reason:'JUPITER_ORDER_BUILD_ERROR',failureClass,
      builderErrorCode:code,builderRouter:router};
  }
  if(order.inputMint!==undefined&&order.inputMint!==inputMint)
   return {ok:false,reason:'JUPITER_INPUT_MINT_MISMATCH'};
  if(order.outputMint!==undefined&&order.outputMint!==outputMint)
   return {ok:false,reason:'JUPITER_OUTPUT_MINT_MISMATCH'};
  if(order.inAmount!==undefined&&order.inAmount!==r.amountRaw)
   return {ok:false,reason:'JUPITER_INPUT_AMOUNT_MISMATCH'};
  if(!/^[1-9][0-9]*$/.test(order.outAmount??''))
   return {ok:false,reason:'JUPITER_OUTPUT_AMOUNT_MISSING'};
  if(typeof order.requestId!=='string'||!order.requestId)
   return {ok:false,reason:'JUPITER_REQUEST_ID_MISSING'};
  if(typeof order.transaction!=='string'||order.transaction.length<100||
     order.transaction.length>3000)
   return {ok:false,reason:'JUPITER_UNSIGNED_TRANSACTION_MISSING'};
  if(order.transactionVersion!==0&&order.transactionVersion!=='0')
   return {ok:false,reason:'JUPITER_UNSUPPORTED_TRANSACTION_VERSION'};
  if(typeof order.router!=='string'||order.router!=='metis'||
     typeof order.feeBps!=='number'||!Number.isSafeInteger(order.feeBps)||
     order.feeBps<0||order.feeBps>MAX_PREVIEW_PLATFORM_FEE_BPS)
   return {ok:false,reason:'UNVERIFIED_ROUTER_OR_PLATFORM_FEE'};
  // Reject gasless / alternate fee-payer routes in this first safe prototype.
  if(order.signatureFeePayer!==r.publicWallet)
   return {ok:false,reason:'UNEXPECTED_FEE_PAYER'};
  const encoded=order.transaction;
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.toString('base64')!==encoded)return {ok:false,reason:'INVALID_ORDER_ENCODING'};
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0||tx.message.addressTableLookups.length>0)
   return {ok:false,reason:'UNRESOLVED_LOOKUP_TABLES'};
  if(tx.message.header.numRequiredSignatures!==1||
     tx.signatures.length!==1||!tx.signatures[0].every(b=>b===0)||
     tx.message.staticAccountKeys[0]?.toBase58()!==r.publicWallet)
   return {ok:false,reason:'UNTRUSTED_ORDER_SIGNER'};
  let swapInstructions=0;
  for(const ix of tx.message.compiledInstructions){
   const program=tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58();
   if(!program||!programs.has(program))return {ok:false,reason:'UNREVIEWED_PROGRAM'};
   if(program==='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')swapInstructions++;
   if(program===SystemProgram.programId.toBase58()&&
      ix.data.length>=4&&Buffer.from(ix.data).readUInt32LE(0)===2)
    return {ok:false,reason:'UNREVIEWED_DIRECT_SOL_TRANSFER'};
  }
  if(swapInstructions!==1)return {ok:false,reason:'NO_UNIQUE_JUPITER_SWAP_INSTRUCTION'};
  const accountAudit=auditEchoUnsignedSwap(encoded,r.publicWallet);
  if('reason' in accountAudit)return {ok:false,reason:accountAudit.reason};
  const orderSha256=createHash('sha256').update(bytes).digest('hex');
  const result=await simulateEchoUnsignedTransaction(r.rpcUrl,encoded,fetcher);
  if(!result.ok)return {ok:false,reason:result.reason,
    failureClass:result.failureClass,orderBuilt:true, unsignedTransactionSha256:orderSha256};
  return {ok:true,reason:'RPC_SIMULATION_SUCCEEDED',side:r.side,
   inputMint,outputMint,inputRaw:r.amountRaw,quotedOutputRaw:order.outAmount,
   unsignedTransactionSha256:orderSha256,
   requestId:order.requestId,logs:result.logs??[],unsignedAudit:accountAudit.audit};
 }catch{return {ok:false,reason:'ORDER_OR_SIMULATION_FAILED'};}
}
