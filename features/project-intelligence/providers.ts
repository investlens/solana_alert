import {decodeFunctionResult,encodeFunctionData,parseAbi,type Hex} from 'viem';
import {address,hash,type Chain} from './model.js';
export const chainConfig={robinhood:{id:4663,explorer:'https://robinhoodchain.blockscout.com',rpc:'https://robinhood-rpc.publicnode.com'},arc:{id:5042,explorer:'https://explorer.arc.io',rpc:'https://rpc.mainnet.arc.io'}};
export type ProviderConfig={rpc:Record<Chain,string>;explorer:Record<Chain,string>;explorerKey?:string;securityKey?:string;socialUrl?:string;socialKey?:string};
export const abi=parseAbi(['function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)','function owner() view returns (address)','function name() view returns (string)','function symbol() view returns (string)']);
export type Reader={rpc:(chain:Chain,method:string,params:unknown[],signal?:AbortSignal)=>Promise<any>;explorer:(chain:Chain,path:string)=>Promise<any>;security:(chain:Chain,token:string)=>Promise<any>;pairs:(chain:Chain,token:string)=>Promise<any>;social?:(url:string)=>Promise<any>;requests:()=>number;remaining?:()=>number};
export function createReader(config:ProviderConfig,options:{signal?:AbortSignal;fetch?:typeof fetch;budget?:number;admit?:()=>boolean}={}):Reader{
 let count=0;const fetcher=options.fetch??fetch;
 async function json(url:string,init:RequestInit={}){
  if(++count>(options.budget??40)||options.admit?.()===false)throw Error('Research request budget exhausted');
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Invalid research provider');
  const signal=AbortSignal.any([options.signal,init.signal,AbortSignal.timeout(5000)].filter((v):v is AbortSignal=>Boolean(v)));
  const response=await fetcher(url,{...init,signal,redirect:'error'});if(!response.ok)throw Error(`Research provider HTTP ${response.status}`);
  if(Number(response.headers.get('content-length')??0)>262144)throw Error('Research response too large');
  const reader=response.body?.getReader();if(!reader)throw Error('Research response missing');let length=0;const chunks:Uint8Array[]=[];
  try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>262144)throw Error('Research response too large');chunks.push(r.value);}}
  catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString());
 }
 return {
  rpc:async(chain,method,params,signal)=>{
   if(!['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_getTransactionReceipt','eth_getTransactionByHash','eth_call','eth_getLogs','eth_simulateV1'].includes(method))throw Error('Read-only method required');
   const r=await json(config.rpc[chain],{signal,method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(r.error||r.result==null)throw Error('Research RPC unavailable');return r.result;
  },
  explorer:(chain,path)=>{
   const base=config.explorer[chain].replace(/\/$/,'');
   // API base includes /api/v2, supporting the official keyed multichain route.
   const url=new URL(base+'/'+path),headers:Record<string,string>={};
   if(config.explorerKey&&url.origin==='https://api.blockscout.com')headers.Authorization=`Bearer ${config.explorerKey}`;
   return json(url.href,{headers});
  },
  security:async(chain,token)=>{const j=await json(`https://api.gopluslabs.io/api/v1/token_security/${chainConfig[chain].id}?contract_addresses=${token}`,{headers:config.securityKey?{Authorization:`Bearer ${config.securityKey}`}:{}});if(j.code!==1||!j.result?.[token])throw Error('Security evidence unavailable');return j.result[token];},
  pairs:(chain,token)=>json(`https://api.dexscreener.com/token-pairs/v1/${chain}/${token}`),
  social:config.socialUrl?url=>json(config.socialUrl!,{method:'POST',headers:{'content-type':'application/json',...(config.socialKey?{Authorization:`Bearer ${config.socialKey}`}:{})},body:JSON.stringify({url,limit:30})}):undefined,
  requests:()=>count,
  remaining:()=>Math.max(0,(options.budget??40)-count),
 };
}
export async function contractRead(reader:Reader,chain:Chain,token:string,block:string,name:'totalSupply'|'balanceOf'|'owner'|'name'|'symbol',wallet?:string):Promise<any>{
 const data=encodeFunctionData({abi,functionName:name,args:name==='balanceOf'?[wallet as Hex]:undefined} as any);
 const result=await reader.rpc(chain,'eth_call',[{to:token,data},block]);
 return decodeFunctionResult({abi,functionName:name,data:result as Hex});
}
export async function pinnedBlock(reader:Reader,chain:Chain){
 const id=await reader.rpc(chain,'eth_chainId',[]);if(!/^0x[0-9a-f]+$/i.test(id)||BigInt(id)!==BigInt(chainConfig[chain].id))throw Error('Research chain identity mismatch');
 const block=await reader.rpc(chain,'eth_blockNumber',[]);if(!/^0x[0-9a-f]+$/i.test(block))throw Error('Research block unavailable');
 const info=await reader.rpc(chain,'eth_getBlockByNumber',[block,false]);if(!hash(info?.hash)||info.number!==block)throw Error('Research block identity unavailable');
 return {block,hash:info.hash};
}
export function safeSocialUrl(value:unknown):string|null{
 try{const u=new URL(String(value));if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
 if(!['x.com','twitter.com','t.me','telegram.me'].includes(u.hostname.toLowerCase()))return null;return u.href;}catch{return null;}
}
export function socialFindings(raw:any,linkedUrl:string,at:string){
 if(raw?.profileUrl!==linkedUrl||!Array.isArray(raw.posts)||raw.posts.length>30)throw Error('Social evidence identity mismatch');
 const now=Date.parse(at),seen=new Set<string>(),posts:{url:string;text:string;publishedAt:string}[]=[];
 for(const p of raw.posts){const url=safeSocialUrl(p?.url),time=Date.parse(p?.publishedAt);if(!url||!Number.isFinite(time)||time>now||time<now-30*86400000||typeof p.text!=='string'||p.text.length>10000||seen.has(url))continue;
  const profile=new URL(linkedUrl),post=new URL(url);if(profile.hostname!==post.hostname||post.pathname.split('/')[1]?.toLowerCase()!==profile.pathname.split('/')[1]?.toLowerCase())continue;
  seen.add(url);posts.push({url,text:p.text,publishedAt:p.publishedAt});
 }
 const unique=new Set(posts.map(p=>p.text.toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim()));
 return {count:posts.length,repeated:posts.length-unique.size,posts:posts.map(({url,publishedAt})=>({url,publishedAt})),limits:'A bounded sample from the linked account, not proof of legitimacy or authentic engagement. Content is treated as untrusted data.'};
}
