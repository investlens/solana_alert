/** Third-party PumpPortal LOCAL unsigned transaction builder.
 * Diagnostic READ-ONLY simulation only. PumpPortal is not Pump.fun official API.
 * Does NOT sign, send, broadcast, execute or prove trade economics.
 * A successful simulation NEVER authorizes signer access.
 */
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {simulateEchoUnsignedTransaction} from './readOnlySimulation.js';
const API='https://pumpportal.fun/api/trade-local';
export const ECHO_PUMP_PORTAL_BROADCAST_ENABLED=false as const;
export type EchoPumpLocalPreview={
 side:'BUY'|'SELL'; wallet:string;mint:string;amount:number;
 /** BUY is in SOL, SELL is raw whole-token units from an independently fetched balance. */
 slippagePercent:number;rpcUrl:string;pool:'pump'|'pump-amm'|'raydium'|'auto';
};
export async function readOnlyPumpLocalPreview(
 r:EchoPumpLocalPreview,fetcher:typeof fetch=fetch
):Promise<{ok:boolean;reason:string;transactionHash?:string;programs?:string[]}>{
 try{
  if(!r.wallet||!r.mint||
    new PublicKey(r.wallet).toBase58()!==r.wallet||
    new PublicKey(r.mint).toBase58()!==r.mint||
    !Number.isFinite(r.amount)||r.amount<=0||
    (r.side==='BUY'&&r.amount>0.1)||
    !Number.isFinite(r.slippagePercent)||r.slippagePercent<=0||
    r.slippagePercent>3||!['BUY','SELL'].includes(r.side))
    return {ok:false,reason:'INVALID_PREVIEW_REQUEST'};
  const response=await fetcher(API,{
   method:'POST',headers:{'content-type':'application/json'},
   signal:AbortSignal.timeout(5000),
   body:JSON.stringify({
    publicKey:r.wallet,action:r.side.toLowerCase(),mint:r.mint,
    amount:r.amount,denominatedInSol:r.side==='BUY'?'true':'false',
    slippage:r.slippagePercent,priorityFee:0,pool:r.pool
   })
  });
  if(!response.ok)return {ok:false,reason:'UNSIGNED_BUILDER_UNAVAILABLE'};
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<100||bytes.length>2250)
   return {ok:false,reason:'UNSIGNED_BYTES_INVALID'};
  const tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0||tx.message.addressTableLookups.length>0)
   return {ok:false,reason:'UNRESOLVED_LOOKUP_TABLES'};
  if(tx.message.header.numRequiredSignatures!==1||
    tx.message.staticAccountKeys[0]?.toBase58()!==r.wallet||
    tx.signatures.length!==1||!tx.signatures[0].every(x=>x===0))
   return {ok:false,reason:'UNTRUSTED_TRANSACTION_SIGNERS'};
  const programs=tx.message.compiledInstructions.map(ix=>
    tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58()??'');
  if(programs.some(p=>!p))return {ok:false,reason:'UNRESOLVED_PROGRAM'};
  const encoded=Buffer.from(bytes).toString('base64');
  const simulated=await simulateEchoUnsignedTransaction(r.rpcUrl,encoded,fetcher);
  if(!simulated.ok)return {ok:false,reason:simulated.reason};
  return {ok:true,reason:'READ_ONLY_SIMULATED_NOT_AUTHORIZED',
    transactionHash:createHash('sha256').update(bytes).digest('hex'),programs};
 }catch{return {ok:false,reason:'BUILDER_OR_SIMULATION_FAILED'};}
}
