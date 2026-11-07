/** Real canonical two-hop PumpSwap route discovery from pinned RPC.
 * Derive canonical pool PDAs with the official installed SDK; independently
 * read both account owners/data and decode base/quote mints. This replaces
 * static example-pool addresses for arbitrary eligible caller mints.
 *
 * This does NOT prove liquidity sufficiency, dynamic fees, a complete BUY
 * transaction or manual SELL, and cannot approve a purchase by itself.
 */
import {PublicKey,type AccountInfo} from '@solana/web3.js';
import {PUMP_SWAP_PROGRAM_ID} from './signerOwnedPumpPoolEvidence.js';
export const ECHO_CANONICAL_PUMP_ROUTE_CAN_SIGN=false as const;
export const ECHO_CANONICAL_PUMP_ROUTE_CAN_BROADCAST=false as const;
const WSOL=new PublicKey('So11111111111111111111111111111111111111112');
const AMM=new PublicKey(PUMP_SWAP_PROGRAM_ID);
export type EchoCanonicalPumpRouteSdk={
 canonicalPumpPoolPda(base:PublicKey,quote?:PublicKey):PublicKey;
 decodePool(account:AccountInfo<Buffer>):{
  baseMint:PublicKey;quoteMint:PublicKey;isMayhemMode:boolean;
 };
};
export type EchoCanonicalPumpRouteRpc={
 getMultipleAccountsInfoAndContext(keys:PublicKey[],config:{
  commitment:'confirmed';minContextSlot:number
 }):Promise<{context:{slot:number};value:(AccountInfo<Buffer>|null)[]}>;
};
export type EchoCanonicalPumpRouteResult=
 |{ok:true;mode:'REAL_CANONICAL_PUMPSWAP_POOL_DISCOVERY';
  firstPool:string;secondPool:string;
  intermediateMint:string;targetMint:string;slot:number;
  quoteAndCpiProven:false;phantomExitProven:false;
  canSign:false;canBroadcast:false}
 |{ok:false;reason:string;canSign:false;canBroadcast:false};
const deny=(reason:string):EchoCanonicalPumpRouteResult=>
 ({ok:false,reason,canSign:false,canBroadcast:false});
export async function discoverEchoCanonicalPumpTwoHop(input:{
 rpc:EchoCanonicalPumpRouteRpc;
 sdk:EchoCanonicalPumpRouteSdk;
 intermediateMint:string;targetMint:string;
}):Promise<EchoCanonicalPumpRouteResult>{
 let a:PublicKey,b:PublicKey,first:PublicKey,second:PublicKey;
 try{
  a=new PublicKey(input.intermediateMint);
  b=new PublicKey(input.targetMint);
  if(a.equals(b)||a.equals(WSOL)||b.equals(WSOL))
   return deny('INVALID_TWO_HOP_MINTS');
  // Official canonical pools: A / WSOL followed by B / A.
  first=input.sdk.canonicalPumpPoolPda(a);
  second=input.sdk.canonicalPumpPoolPda(b,a);
  if(first.equals(second))return deny('DUPLICATED_CANONICAL_POOL');
 }catch{return deny('OFFICIAL_CANONICAL_POOL_DERIVATION_FAILED');}
 try{
  const observed=await input.rpc.getMultipleAccountsInfoAndContext(
   [first,second],{commitment:'confirmed',minContextSlot:1});
  if(!Number.isSafeInteger(observed.context?.slot)||
    observed.context.slot<=0||observed.value.length!==2)
   return deny('INCOMPLETE_POOL_RPC_SNAPSHOT');
  const accounts=observed.value;
  if(accounts.some(p=>!p||p.executable||
      !p.owner.equals(AMM)||p.data.length<64))
   return deny('MISSING_OR_FOREIGN_CANONICAL_POOL');
  const p1=input.sdk.decodePool(accounts[0]!);
  const p2=input.sdk.decodePool(accounts[1]!);
  if(!p1.baseMint.equals(a)||!p1.quoteMint.equals(WSOL)||
     !p2.baseMint.equals(b)||!p2.quoteMint.equals(a)||
     p1.isMayhemMode||p2.isMayhemMode)
   return deny('CANONICAL_POOL_MINT_OR_MODE_MISMATCH');
  return {ok:true,mode:'REAL_CANONICAL_PUMPSWAP_POOL_DISCOVERY',
   firstPool:first.toBase58(),secondPool:second.toBase58(),
   intermediateMint:a.toBase58(),targetMint:b.toBase58(),
   slot:observed.context.slot,
   quoteAndCpiProven:false,phantomExitProven:false,
   canSign:false,canBroadcast:false};
 }catch{return deny('CANONICAL_POOL_RPC_OR_DECODE_FAILED');}
}
/** Installed official SDK optional loader. Never fetch code or trust a
 * coordinator-supplied package identifier. Missing export fails closed.
 */
export async function loadEchoCanonicalSdkFromInstalledPackage():
 Promise<EchoCanonicalPumpRouteSdk|null>{
 try{
  const name:string='@pump-fun/pump-sdk/swap';
  const mod=await import(name) as Record<string,unknown>;
  if(typeof mod.canonicalPumpPoolPda!=='function'||
     typeof (mod.PUMP_AMM_SDK as Record<string,unknown>|undefined)?.decodePool!=='function')
   return null;
  const fn=mod.canonicalPumpPoolPda as
   (mint:PublicKey,quote?:PublicKey)=>PublicKey;
  const decoder=(mod.PUMP_AMM_SDK as {decodePool:(a:AccountInfo<Buffer>)=>
   {baseMint:PublicKey;quoteMint:PublicKey;isMayhemMode:boolean}}).decodePool;
  return {canonicalPumpPoolPda:fn,decodePool:decoder};
 }catch{return null;}
}
