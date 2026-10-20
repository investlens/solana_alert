import {decodeFunctionResult,encodeFunctionData,parseAbi} from 'viem';
const ABI=parseAbi(['function token() view returns(address)','function pairToken() view returns(address)',
 'function getReserves() view returns(uint256,uint256)','function graduated() view returns(bool)']);
export type CurveObservation={status:'MEASURED'|'GRADUATED'|'UNAVAILABLE';price:number|null;at:string;block:string|null;block_hash:string|null;reason?:string};
type Rpc=(args:{method:string;params:unknown[]})=>Promise<unknown>;
const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[a-f0-9]{40}$/i.test(v)&&!/^0x0{40}$/i.test(v);
export async function readPrebondResearchQuote(token:string,curve:string,rpc:Rpc,now=Date.now,check=()=>{}):Promise<CurveObservation>{
 const unavailable=(reason:string):CurveObservation=>({status:'UNAVAILABLE',price:null,at:new Date(now()).toISOString(),block:null,block_hash:null,reason});
 if(!address(token)||!address(curve)||token.toLowerCase()===curve.toLowerCase())return unavailable('INVALID_IDENTITY');
 try{
  check();const raw=await rpc({method:'eth_blockNumber',params:[]});check();
  if(typeof raw!=='string'||!/^0x[a-f0-9]+$/i.test(raw)||BigInt(raw)<2n)return unavailable('INVALID_HEAD');
  const height=BigInt(raw)-2n,block='0x'+height.toString(16);
  const header:any=await rpc({method:'eth_getBlockByNumber',params:[block,false]});check();
  if(!header||header.number?.toLowerCase()!==block||!/^0x[a-f0-9]{64}$/i.test(header.hash??'')||!/^0x[a-f0-9]+$/i.test(header.timestamp??''))return unavailable('INVALID_BLOCK');
  const at=Number(BigInt(header.timestamp))*1000;
  if(!Number.isSafeInteger(at)||at>now()||now()-at>30_000)return unavailable('STALE_BLOCK');
  const read=async(functionName:'token'|'pairToken'|'getReserves'|'graduated')=>{
   check();const value=await rpc({method:'eth_call',params:[{to:curve,data:encodeFunctionData({abi:ABI,functionName})},block]});check();
   if(typeof value!=='string'||!/^0x[a-f0-9]+$/i.test(value))throw Error('Invalid response');
   return decodeFunctionResult({abi:ABI,functionName,data:value as `0x${string}`});
  };
  // Serial reads respect the existing provider gate and use exactly one block.
  const actualToken=await read('token'),quote=await read('pairToken');
  if(String(actualToken).toLowerCase()!==token.toLowerCase())return unavailable('TOKEN_MISMATCH');
  if(String(quote).toLowerCase()!=='0x'+'0'.repeat(40))return unavailable('NON_NATIVE_QUOTE');
  const graduated=await read('graduated');
  const identity={at:new Date(at).toISOString(),block:height.toString(),block_hash:String(header.hash).toLowerCase()};
  if(graduated===true)return {status:'GRADUATED',price:null,...identity,reason:'VENUE_TRANSITION'};
  const reserves=await read('getReserves') as readonly [bigint,bigint];
  const price=Number(reserves[0])/Number(reserves[1]);check();
  if(reserves[0]<=0n||reserves[1]<=0n||!Number.isFinite(price)||price<=0)return unavailable('INVALID_RESERVES');
  if(now()-at>30_000)return unavailable('STALE_BLOCK');
  return {status:'MEASURED',price,...identity};
 }catch{return unavailable('PROVIDER_UNAVAILABLE');}
}
