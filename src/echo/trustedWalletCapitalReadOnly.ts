/** Trusted-wallet BALANCE evidence for Echo's $30 atomic reservation.
 * Read-only Solana RPC + independent price adapter. No Telegram-supplied
 * wallet balances, credentials, signing keys, or transaction submissions.
 * The trusted price provider must be bound server-side and independently
 * verified; do not accept prices from caller payloads.
 */
import {verifyEchoExecutionWallet} from './executionWallet.js';

export type EchoSolUsdPrice={
 usdCentsPerSol:number;observedAtMs:number;source:string;
};
export interface EchoTrustedSolUsdPriceReader {
 readFreshSolUsd():Promise<EchoSolUsdPrice>;
}
export type EchoWalletCapitalProof=
 | {ok:true;wallet:string;lamports:string;spendableWalletCents:string;
     balanceVerifiedAtIso:string;contextSlot:number;solUsdCents:number;
     readOnly:true}
 | {ok:false;reason:string;readOnly:true};
export const ECHO_BALANCE_PROOF_ALLOWS_SIGNING=false as const;
export async function readEchoVerifiedWalletCapital(args:{
 wallet:string;rpcUrl:string;priceReader:EchoTrustedSolUsdPriceReader;
 minContextSlot?:number;clock?:()=>number;post?:typeof fetch;
}):Promise<EchoWalletCapitalProof>{
 const fail=(reason:string):EchoWalletCapitalProof=>({ok:false,reason,readOnly:true});
 if(!verifyEchoExecutionWallet(args.wallet))return fail('WALLET_NOT_PINNED');
 try{
  const u=new URL(args.rpcUrl);
  if(u.protocol!=='https:'||u.username||u.password||u.hash)
   return fail('INVALID_RPC_URL');
 }catch{return fail('INVALID_RPC_URL');}
 const clock=args.clock??Date.now,started=clock();
 if(!Number.isSafeInteger(started))return fail('INVALID_CLOCK');
 let response:Response,price:EchoSolUsdPrice;
 try{
  // Parallel reads: one bounded RPC query and one trusted SOL/USD feed read.
  [response,price]=await Promise.all([
   (args.post??fetch)(args.rpcUrl,{
    method:'POST',headers:{'content-type':'application/json'},
    signal:AbortSignal.timeout(3000),
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',
     params:[args.wallet,{commitment:'confirmed',
      ...(args.minContextSlot!==undefined?{minContextSlot:args.minContextSlot}:{})}]})
   }),args.priceReader.readFreshSolUsd()
  ]);
 }catch{return fail('TRUSTED_CHAIN_OR_PRICE_UNAVAILABLE');}
 const observed=clock();
 if(!Number.isSafeInteger(observed)||observed<started||observed-started>3000)
  return fail('STALE_CHAIN_REQUEST');
 if(!Number.isSafeInteger(price.usdCentsPerSol)||price.usdCentsPerSol<=0||
    price.usdCentsPerSol>10_000_000||
    !Number.isSafeInteger(price.observedAtMs)||price.observedAtMs>observed||
    observed-price.observedAtMs>2000||!price.source?.trim())
  return fail('UNVERIFIED_SOL_USD_PRICE');
 if(!response.ok)return fail('BALANCE_RPC_REJECTED');
 let result:any;
 try{result=await response.json();}
 catch{return fail('INVALID_RPC_BALANCE_RESPONSE');}
 const lamports=result?.result?.value,slot=result?.result?.context?.slot;
 if(result?.error||!Number.isSafeInteger(lamports)||lamports<0||
    !Number.isSafeInteger(slot)||slot<=0||
    (args.minContextSlot!==undefined&&slot<args.minContextSlot))
  return fail('RPC_BALANCE_OR_SLOT_UNVERIFIED');
 const cents=BigInt(lamports)*BigInt(price.usdCentsPerSol)/1_000_000_000n;
 if(cents>BigInt(Number.MAX_SAFE_INTEGER))return fail('BALANCE_OUT_OF_RANGE');
 return {ok:true,wallet:args.wallet,lamports:String(lamports),
  spendableWalletCents:String(cents),
  balanceVerifiedAtIso:new Date(observed).toISOString(),
  contextSlot:slot,solUsdCents:price.usdCentsPerSol,readOnly:true};
}
