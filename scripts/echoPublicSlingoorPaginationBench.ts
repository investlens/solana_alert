/** Bounded public-RPC shadow benchmark. NO daemon, no signed transaction,
 * no production RPC secrets, no state mutation, no Telegram delivery.
 * Maximum 4 public RPC calls (2 per endpoint); does not prove production
 * checkpoint/queue/Telegram latency acceptance.
 */
import { advanceFreshScan, type FreshScanState } from '../src/echo/freshScan.js';
const WALLET='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const providers=['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com'];
const result:any[]=[];
let budget=4,validated=false;
for(const endpoint of providers){
 if(validated||budget<2)break;
 const host=new URL(endpoint).hostname;
 async function signatures(limit:number){
  budget--;
  const started=performance.now();
  try {
   const response=await fetch(endpoint,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSignaturesForAddress',params:[WALLET,{limit,commitment:'confirmed'}]}),
    signal:AbortSignal.timeout(12_000)
   });
   const body=await response.json();
   return {status:response.status,elapsedMs:Math.round(performance.now()-started),
    rows:Array.isArray(body?.result)?body.result:null,error:body?.error?.message??null,
    bytes:JSON.stringify(body).length};
  }catch(e){return {status:0,elapsedMs:Math.round(performance.now()-started),rows:null,error:String(e).slice(0,100),bytes:0};}
 }
 const small=await signatures(100);
 const large=await signatures(1000);
 const a=small.rows??[],b=large.rows??[];
 const sameHead=a.length>0&&b.length>0&&a[0].signature===b[0].signature;
 // This is a synthetic checkpoint from public on-chain data, not Railway state.
 const syntheticCheckpoint=b[Math.min(899,b.length-1)]?.signature??null;
 const earlier:FreshScanState={checkpoint:syntheticCheckpoint,before:null,candidate:null};
 const scan100=syntheticCheckpoint?advanceFreshScan(earlier,a,100):null;
 const scan1000=syntheticCheckpoint?advanceFreshScan(earlier,b,1000):null;
 const foundIn100=!!syntheticCheckpoint&&a.some((r:any)=>r.signature===syntheticCheckpoint);
 const foundIn1000=!!syntheticCheckpoint&&b.some((r:any)=>r.signature===syntheticCheckpoint);
 const consistentHead=a.length>0&&a.every((row:any,i:number)=>b[i]?.signature===row.signature);
 const proof={
  endpoint:host,smallHttpStatus:small.status,largeHttpStatus:large.status,
  smallRows:a.length,largeRows:b.length,
  smallMs:small.elapsedMs,largeMs:large.elapsedMs,
  smallBytes:small.bytes,largeBytes:large.bytes,
  consistentHead,syntheticCheckpointIndex:b.length?Math.min(899,b.length-1):null,
  foundIn100,foundIn1000,
  priorCheckpointReachedOnLarge:scan1000?.complete===true&&scan1000.cutoffWithoutCheckpoint===false,
  priorCheckpointReachedOnSmall:scan100?.complete===true&&scan100.cutoffWithoutCheckpoint===false,
  smallError:small.error,largeError:large.error
 };
 result.push(proof);
 console.log('ECHO_PUBLIC_RPC_PAGINATION_BENCH',JSON.stringify(proof));
 if(small.status===200&&large.status===200&&b.length>=900&&consistentHead&&sameHead&&
    proof.priorCheckpointReachedOnLarge&&proof.priorCheckpointReachedOnSmall===false)validated=true;
}
console.log('ECHO_PUBLIC_RPC_BENCH_SUMMARY',JSON.stringify({
 validatedPublicPageShape:validated,productionCheckpointTested:false,
 productionRpcReductionMeasured:false,liveTelegramDelayMeasured:false,totalCalls:4-budget,
 result:validated?'SHADOW_PAGE_SHAPE_PASS':'NOT_VERIFIED'
}));
if(!validated)process.exitCode=1;
