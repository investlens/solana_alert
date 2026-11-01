/** Bounded read-only Solana prioritization-fee snapshot.
 * Use an existing authorized RPC endpoint from a read-only research runner.
 * One call only, no retries on rate limits; never signs or submits anything.
 */
import type {EchoObservedPriorityFee} from './landingFeeShadow.js';
const ACCOUNT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export type EchoRpcFeeSnapshot={
 samples:EchoObservedPriorityFee[];rpcCalls:1;readOnly:true;
 observedAtMs:number;writableAccountCount:number;
};
export async function readEchoRecentPrioritizationFees(input:{
 rpcUrl:string;writableAccounts:readonly string[];
 fetcher?:typeof fetch;nowMs?:number
}):Promise<EchoRpcFeeSnapshot>{
 const now=input.nowMs??Date.now();
 if(!Number.isSafeInteger(now)||now<=0||
    input.writableAccounts.length<1||input.writableAccounts.length>32||
    !input.writableAccounts.every(x=>ACCOUNT.test(x))||
    new Set(input.writableAccounts).size!==input.writableAccounts.length)
  throw Error('INVALID_WRITABLE_FEE_ACCOUNTS');
 let u:URL;
 try{u=new URL(input.rpcUrl);}catch{throw Error('INVALID_RPC_URL');}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||
    u.search||u.pathname!=='/'&&u.pathname.length>140)
  throw Error('INVALID_RPC_URL');
 const fetcher=input.fetcher??fetch;
 const response=await fetcher(input.rpcUrl,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getRecentPrioritizationFees',
   params:[input.writableAccounts]}),
  signal:AbortSignal.timeout(5000)
 });
 if(response.status===429)throw Error('FEE_RPC_THROTTLED_NO_RETRY');
 if(!response.ok)throw Error('FEE_RPC_UNAVAILABLE');
 const advertised=Number(response.headers.get('content-length')??'0');
 if(Number.isFinite(advertised)&&advertised>64_000)
  throw Error('FEE_RPC_RESPONSE_TOO_LARGE');
 const body=await response.text();
 if(body.length>64_000)throw Error('FEE_RPC_RESPONSE_TOO_LARGE');
 let data:any;
 try{data=JSON.parse(body);}catch{throw Error('INVALID_FEE_RPC_JSON');}
 if(data?.error||!Array.isArray(data?.result)||
    data.result.length>150||data.result.length<5)
  throw Error('INVALID_FEE_RPC_RESULT');
 const samples:EchoObservedPriorityFee[]=[];
 const slots=new Set<number>();
 for(const item of data.result){
  if(!Number.isSafeInteger(item?.slot)||item.slot<=0||
     !Number.isSafeInteger(item?.prioritizationFee)||item.prioritizationFee<0||
     slots.has(item.slot))
   throw Error('INVALID_FEE_SAMPLE');
  slots.add(item.slot);
  samples.push({slot:item.slot,prioritizationFee:item.prioritizationFee});
 }
 // A response that includes older observations is not proof of current
 // account congestion. Callers must separately verify slot freshness.
 return {samples,rpcCalls:1,readOnly:true,observedAtMs:now,
  writableAccountCount:input.writableAccounts.length};
}
