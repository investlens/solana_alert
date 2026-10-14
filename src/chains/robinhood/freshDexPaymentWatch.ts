import {recentDexPayment} from './dexPaidWatchState.js';
import {getSharedJson,setSharedJson} from '../../services/sharedJsonCache.js';
export type FreshPayment={token:string;payment:number;observedAt:number};
const KEY='alphaos:robinhood:fresh-dex-payments:v1';
const paymentMs=(v:number)=>v<10_000_000_000?v*1000:v;
export function createFreshDexPaymentWatch(limit=24){
 const rows=new Map<string,FreshPayment>();
 const prune=(now:number)=>{for(const [key,row]of rows)if(now<row.observedAt||now-paymentMs(row.payment)>30*60000)rows.delete(key);};
 const valid=(row:FreshPayment,now:number)=>/^0x[a-f0-9]{40}$/i.test(row.token)&&Number.isFinite(row.payment)&&Number.isFinite(row.observedAt)&&recentDexPayment(row.payment,row.observedAt)&&now>=row.observedAt&&now-paymentMs(row.payment)<=30*60000;
 return {
  observe(token:string,payment:number,now=Date.now()){prune(now);const key=token.toLowerCase();if(!valid({token:key,payment,observedAt:now},now))return false;
   const prior=rows.get(key);if(prior?.payment===payment)return false;
   rows.set(key,{token:key,payment,observedAt:now});while(rows.size>limit)rows.delete(rows.keys().next().value!);return true;},
  has(token:string,payment:number,now=Date.now()){prune(now);const row=rows.get(token.toLowerCase());return !!row&&paymentMs(row.payment)===paymentMs(payment)&&valid(row,now);},
  restore(raw:unknown,now=Date.now()){if(Array.isArray(raw))for(const row of raw.slice(-limit))if(row&&typeof row.token==='string'&&valid(row,now)&&paymentMs(rows.get(row.token.toLowerCase())?.payment??0)<=paymentMs(row.payment))rows.set(row.token.toLowerCase(),{token:row.token.toLowerCase(),payment:row.payment,observedAt:row.observedAt});prune(now);while(rows.size>limit)rows.delete(rows.keys().next().value!);},
  remove(token:string,payment:number){const row=rows.get(token.toLowerCase());if(row&&paymentMs(row.payment)===paymentMs(payment))return rows.delete(token.toLowerCase());return false;},
  snapshot(now=Date.now()){prune(now);return [...rows.values()].map(row=>({...row}));},
 };
}
const watch=createFreshDexPaymentWatch();let loading:Promise<void>|undefined;
export function observeFreshDexPayment(token:string,payment:number,now=Date.now()):boolean {
 if(watch.observe(token,payment,now))void setSharedJson(KEY,watch.snapshot(now),new Date(now).toISOString(),3600000);
 return watch.has(token,payment,now);
}
export const previouslyObservedFreshPayment=(token:string,payment:number,now=Date.now())=>watch.has(token,payment,now);
export async function restoreFreshDexPayments(){
 loading??=(async()=>{watch.restore((await getSharedJson<unknown>(KEY,1000))?.value);})();await loading;return watch.snapshot();
}

export const currentFreshDexPayments=()=>watch.snapshot();
export function completeFreshDexPayment(token:string,payment:number){if(watch.remove(token,payment))void setSharedJson(KEY,watch.snapshot(),new Date().toISOString(),3600000);}
