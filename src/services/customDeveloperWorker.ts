import { runDatabaseWork } from './databaseLoadGovernor.js';
import { readDirectDeployment, type DeploymentProof, type DeveloperChain } from './customDeveloperVerification.js';
import { robinhoodExplorerAccess } from './explorerAccessConfig.js';

type Claim={chain:DeveloperChain;token:string;lease:string};
export function createCustomDeveloperWorker(deps:{now:()=>number;claim:()=>Promise<Claim|null>;verify:(claim:Claim)=>Promise<DeploymentProof|null>;finish:(claim:Claim,proof:DeploymentProof|null)=>Promise<unknown>}) {
 let running=false,nextAt=0;
 return async()=>{
  if(running||deps.now()<nextAt)return;
  running=true; nextAt=deps.now()+10*60000;
  let claim:Claim|null=null;
  try {
   claim=await deps.claim(); if(!claim)return;
   let proof:DeploymentProof|null=null;
   try{proof=await deps.verify(claim);}catch{nextAt=deps.now()+60*60000;}
   const result=await deps.finish(claim,proof);
   console.log('[CustomDeveloper] CHECK',{chain:claim.chain,result});
  } catch {nextAt=deps.now()+60*60000;console.warn('[CustomDeveloper] unavailable; background checks paused for one hour');}
  finally{running=false;}
 };
}

// A single endpoint, six RPC reads maximum, no retries/failover or archive scan.
// Dedicated fetch deadlines cannot consume the alert RPC provider queue.
async function json(url:string,signal:AbortSignal,body?:unknown):Promise<any>{
 const response=await fetch(url,{method:body?'POST':'GET',headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal});
 if(!response.ok||!(response.headers.get('content-type')??'').includes('json'))throw new Error('Deployment provider unavailable');
 if(!response.body)throw new Error('Deployment response missing');
 const reader=response.body.getReader();const parts:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>512000){await reader.cancel();throw new Error('Deployment evidence exceeds budget');}parts.push(part.value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export async function verifyCustomDeveloper(claim:Claim):Promise<DeploymentProof|null>{
 const total=AbortSignal.timeout(12000);
 const arcKey=(process.env.ARC_BLOCKSCOUT_API_KEY??process.env.BLOCKSCOUT_API_KEY??'').trim();
 const access=claim.chain==='robinhood'?robinhoodExplorerAccess(process.env):{
  baseUrl:arcKey?'https://api.blockscout.com/5042/api/v2':'https://explorer.arc.io/api/v2',apiKey:arcKey||undefined};
 const url=new URL(`${access.baseUrl}/addresses/${claim.token}`);
 if(access.apiKey)url.searchParams.set('apikey',access.apiKey);
 const rpcUrl=claim.chain==='arc'?(process.env.ARC_RPC_URL?.trim()||'https://rpc.mainnet.arc.io')
  :(process.env.ROBINHOOD_RPC_URL?.trim()||'https://rpc.mainnet.chain.robinhood.com');
 return readDirectDeployment(claim.chain,claim.token,{
  explorer:()=>json(url.toString(),AbortSignal.any([total,AbortSignal.timeout(2000)])),
  rpc:async(method,params)=>{
   const payload=await json(rpcUrl,AbortSignal.any([total,AbortSignal.timeout(2000)]),{jsonrpc:'2.0',id:1,method,params});
   if(payload?.jsonrpc!=='2.0'||payload?.id!==1||payload.error||!Object.prototype.hasOwnProperty.call(payload,'result'))throw new Error('Deployment RPC unavailable');
   return payload.result;
  },
 });
}
async function rpc(name:string,args:Record<string,unknown>={}):Promise<any>{
 return runDatabaseWork('BACKGROUND',async()=>{
  const {supabase}=await import('./supabase.js');
  const {data,error}=await supabase.rpc(name,args).abortSignal(AbortSignal.timeout(2000));
  if(error)throw error;return data;
 });
}
export const runCustomDeveloperVerification=createCustomDeveloperWorker({
 now:Date.now,
 claim:()=>rpc('alpha_claim_creator_verification'),verify:verifyCustomDeveloper,
 finish:(claim,proof)=>rpc('alpha_finish_creator_verification',{p_chain:claim.chain,p_token:claim.token,p_lease:claim.lease,p_proof:proof}),
});
