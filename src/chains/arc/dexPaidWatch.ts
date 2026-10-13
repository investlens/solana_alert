import { governedDexScreenerJson } from '../../services/dexscreenerRequestGovernor.js';
import { parseDexScreenerPaidOrders } from '../robinhood/security/dexPaidScanner.js';
import { claimSharedDelivery, runSharedAtomic, getSharedJson, setSharedJson } from '../../services/sharedJsonCache.js';
export const ARC_PAID_DISCOVERY_FEEDS=['token-profiles/latest/v1','token-profiles/recent-updates/v1','ads/latest/v1','community-takeovers/latest/v1'] as const;
type Dependencies={security:(token:string)=>Promise<{allowed:boolean;reason:string}>;send:(token:string,paymentAt:number)=>Promise<void|{delivered:number;failed:number}>;
 read?:(url:string)=>Promise<unknown>;claim?:(key:string,ttl:number)=>Promise<string>;now?:()=>number};
export function freshArcPayment(payload:unknown,now:number):number|null{
 const parsed=parseDexScreenerPaidOrders(payload);if(parsed.malformed)return null;
 const times=parsed.orders.filter(o=>!['cancelled','rejected'].includes(String(o.status).toLowerCase())).map(o=>o.paymentTimestamp).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0).map(v=>v<10000000000?v*1000:v);
 const at=times.length?Math.max(...times):null;
 return at!=null&&now-at>=-30000&&now-at<=600000?at:null;
}
// Existing ARC worker calls tick; no extra poller or database writes.
export function createArcDexPaidWatch(deps:Dependencies){
 const now=deps.now??Date.now;const watch=new Map<string,{seen:number;checked:number;promotion:boolean}>();const done=new Map<string,number>();
 let lastTick=0,lastDiscovery=0,discoverySlot=0,running=false,restored=false;
 const pendingPayments=new Map<string,{at:number;observedAt:number}>();
 const checkpointKey='alphaos:arc:pending-dex-payments:v1';
 const savePending=async()=>{if(deps.read)return;const at=now();await setSharedJson(checkpointKey,[...pendingPayments].slice(-24),new Date(at).toISOString(),3600000);};
 const read=deps.read??(async(url:string)=>(await governedDexScreenerJson<unknown>({url,caller:'arc_dex_paid',endpoint:url.includes('/orders/')?'ORDERS':'PROFILES',priority:'NORMAL',cacheKey:url,cacheTtlMs:url.includes('/orders/')?10000:60000,queueWaitTimeoutMs:1000,httpTimeoutMs:2500})).value);
 const seed=(token:string,promotion=false)=>{if(!/^0x[a-fA-F0-9]{40}$/.test(token))return;const key=token.toLowerCase();if(watch.size>=24&&!watch.has(key)){const oldest=[...watch].sort((a,b)=>Number(a[1].promotion)-Number(b[1].promotion)||a[1].seen-b[1].seen)[0];if(!promotion&&oldest[1].promotion)return;watch.delete(oldest[0]);}const prior=watch.get(key);watch.set(key,{seen:now(),checked:prior?.checked??0,promotion:promotion||prior?.promotion||false});};
 return {seed,async tick(){
  if(running||now()-lastTick<30000)return;running=true;lastTick=now();
  let checked=0,detected=0,blocked=0,failed=0;
  try{
   if(!restored){restored=true;if(!deps.read){const saved=await getSharedJson<unknown>(checkpointKey);if(Array.isArray(saved?.value))for(const row of saved.value.slice(-24)){
    const [token,payment]=Array.isArray(row)?row:[];
    if(typeof token==='string'&&/^0x[a-f0-9]{40}$/i.test(token)&&Number.isFinite(payment?.at)&&Number.isFinite(payment?.observedAt)&&payment.observedAt-payment.at>=-30000&&payment.observedAt-payment.at<=600000&&now()-payment.at>=-30000&&now()-payment.at<=1800000){pendingPayments.set(token,payment);seed(token,true);}
   }}}
   for(const [key,payment]of pendingPayments)if(now()-payment.at>1800000)pendingPayments.delete(key);
   for(const [key,v]of watch)if(now()-v.seen>1800000)watch.delete(key);
   for(const [key,at]of done)if(now()-at>86400000)done.delete(key);
   if(now()-lastDiscovery>=60000){lastDiscovery=now();try{const endpoint=ARC_PAID_DISCOVERY_FEEDS[discoverySlot++%ARC_PAID_DISCOVERY_FEEDS.length];const feed=await read('https://api.dexscreener.com/'+endpoint);if(Array.isArray(feed))for(const row of feed.slice(0,100))if(row?.chainId==='arc')seed(String(row.tokenAddress??''),true);}catch{failed++;}}
   for(const [token,v]of [...watch].sort((a,b)=>Number(b[1].promotion)-Number(a[1].promotion)||a[1].checked-b[1].checked).slice(0,2)){
    v.checked=now();checked++;
    try{const fresh=freshArcPayment(await read(`https://api.dexscreener.com/orders/v1/arc/${token}`),now());
     if(fresh!=null&&fresh!==(pendingPayments.get(token)?.at??null)){pendingPayments.set(token,{at:fresh,observedAt:now()});while(pendingPayments.size>24)pendingPayments.delete(pendingPayments.keys().next().value!);await savePending();}
     const at=fresh??pendingPayments.get(token)?.at??null;if(at==null)continue;
     const identity=`alphaos:arc:dex-paid:${token}:${at}`;if(done.has(identity))continue;
     const security=await deps.security(token);if(!security.allowed){blocked++;console.log('[ArcDexPaid] SELLABILITY_BLOCK',{reason:security.reason});continue;}
     const owner=crypto.randomUUID();
     const claim=deps.claim?await deps.claim(identity,90000):await claimSharedDelivery(identity,90000,owner);if(claim!=='CLAIMED')continue;
     try {
       const result=await deps.send(token,at);
       if(result && (result.delivered<1||result.failed>0)){failed++;continue;}
       if(done.size>=100)done.delete(done.keys().next().value!);done.set(identity,now());pendingPayments.delete(token);await savePending();detected++;
     } finally {
       if(!deps.claim)await runSharedAtomic("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",[identity],[owner]).catch(()=>undefined);
     }
    }catch{failed++;}
   }
   console.log('[ArcDexPaid] CYCLE',{candidates:watch.size,checked,detected,blocked,failed,cap:24,dbWrites:0});
  }finally{running=false;}
 },size:()=>watch.size};
}
