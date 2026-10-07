import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { requestRobinhoodRpcResilient } from '../chains/robinhood/rpc.js';
const abi=parseAbi(['function name() view returns (string)','function symbol() view returns (string)']);
export type TokenIdentity={name?:string;symbol?:string};
async function load(token:string):Promise<TokenIdentity>{
 const read=async(functionName:'name'|'symbol')=>{
  const data=await requestRobinhoodRpcResilient({method:'eth_call',params:[{to:token,data:encodeFunctionData({abi,functionName})},'latest']});
  return decodeFunctionResult({abi,functionName,data:data as `0x${string}`});
 };
 const [name,symbol]=await Promise.allSettled([read('name'),read('symbol')]);
 return {name:name.status==='fulfilled'?name.value:undefined,symbol:symbol.status==='fulfilled'?symbol.value:undefined};
}
export function createTokenIdentityReader(loader=load,clock=Date.now){
 const cache=new Map<string,{expires:number;value:TokenIdentity}>(),pending=new Map<string,Promise<TokenIdentity>>();
 let window=0,started=0;
 return async(token:string):Promise<TokenIdentity>=>{
  if(!/^0x[a-f0-9]{40}$/i.test(token))return {};
  const key=token.toLowerCase(),now=clock(),hit=cache.get(key);
  if(hit&&hit.expires>now)return hit.value;
  if(pending.has(key))return pending.get(key)!;
  if(now-window>=60000){window=now;started=0;}
  if(pending.size>=2||started>=10)return {};started++;
  const work=(async()=>{
   let value:TokenIdentity={};
   try{const raw=await loader(token);for(const field of ['name','symbol'] as const){
    const v=raw[field]?.trim();if(v&&v.length<=(field==='name'?120:32)&&!/[\u0000-\u001f\u007f]/.test(v))value[field]=v;
   }}catch{}
   if(cache.size>=100)cache.delete(cache.keys().next().value!);
   cache.set(key,{value,expires:clock()+(value.name&&value.symbol?300000:10000)});return value;
  })();pending.set(key,work);try{return await work;}finally{pending.delete(key);}
 };
}
export const readRobinhoodTokenIdentity=createTokenIdentityReader();
