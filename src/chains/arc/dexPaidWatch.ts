import { governedDexScreenerJson } from '../../services/dexscreenerRequestGovernor.js';
import { parseDexScreenerPaidOrders } from '../robinhood/security/dexPaidScanner.js';
import { claimSharedDelivery } from '../../services/sharedJsonCache.js';
type Dependencies={security:(token:string)=>Promise<{allowed:boolean;reason:string}>;send:(token:string,paymentAt:number)=>Promise<void>;
 read?:(url:string)=>Promise<unknown>;claim?:(key:string,ttl:number)=>Promise<string>;now?:()=>number};
export function freshArcPayment(payload:unknown,now:number):number|null{
 const parsed=parseDexScreenerPaidOrders(payload);if(parsed.malformed)return null;
 const times=parsed.orders.filter(o=>!['cancelled','rejected'].includes(String(o.status).toLowerCase())).map(o=>o.paymentTimestamp).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0).map(v=>v<10000000000?v*1000:v);
 const at=times.length?Math.max(...times):null;
 return at!=null&&now-at>=-30000&&now-at<=600000?at:null;
}
// Existing ARC worker calls tick; no extra poller or database writes.
export function createArcDexPaidWatch(deps:Dependencies){
 const now=deps.now??Date.now;const watch=new Map<string,{seen:number;checked:number}>();const done=new Map<string,number>();
 let lastTick=0,lastDiscovery=0,running=false;
 const read=deps.read??(async(url:string)=>(await governedDexScreenerJson<unknown>({url,caller:'arc_dex_paid',endpoint:url.includes('/orders/')?'ORDERS':'PROFILES',priority:'NORMAL',cacheKey:url,cacheTtlMs:url.includes('/orders/')?10000:60000,queueWaitTimeoutMs:1000,httpTimeoutMs:2500})).value);
 const seed=(token:string)=>{if(!/^0x[a-fA-F0-9]{40}$/.test(token))return;const key=token.toLowerCase();if(watch.size>=24&&!watch.has(key))watch.delete([...watch].sort((a,b)=>a[1].seen-b[1].seen)[0][0]);const prior=watch.get(key);watch.set(key,{seen:now(),checked:prior?.checked??0});};
 return {seed,async tick(){
  if(running||now()-lastTick<30000)return;running=true;lastTick=now();
  let checked=0,detected=0,blocked=0,failed=0;
  try{
   for(const [key,v]of watch)if(now()-v.seen>1800000)watch.delete(key);
   for(const [key,at]of done)if(now()-at>86400000)done.delete(key);
   if(now()-lastDiscovery>=60000){lastDiscovery=now();try{const feed=await read('https://api.dexscreener.com/token-profiles/latest/v1');if(Array.isArray(feed))for(const row of feed.slice(0,100))if(row?.chainId==='arc')seed(String(row.tokenAddress??''));}catch{failed++;}}
   for(const [token,v]of [...watch].sort((a,b)=>a[1].checked-b[1].checked).slice(0,2)){
    v.checked=now();checked++;
    try{const at=freshArcPayment(await read(`https://api.dexscreener.com/orders/v1/arc/${token}`),now());if(at==null)continue;
     const identity=`alphaos:arc:dex-paid:${token}:${at}`;if(done.has(identity))continue;
     const security=await deps.security(token);if(!security.allowed){blocked++;console.log('[ArcDexPaid] SELLABILITY_BLOCK',{reason:security.reason});continue;}
     const claim=await(deps.claim??claimSharedDelivery)(identity,86400000);if(claim!=='CLAIMED')continue;
     if(done.size>=100)done.delete(done.keys().next().value!);done.set(identity,now());
     await deps.send(token,at);detected++;
    }catch{failed++;}
   }
   console.log('[ArcDexPaid] CYCLE',{candidates:watch.size,checked,detected,blocked,failed,cap:24,dbWrites:0});
  }finally{running=false;}
 },size:()=>watch.size};
}
