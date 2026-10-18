import {createHash} from 'node:crypto';
import {runSharedAtomic} from './sharedJsonCache.js';

const TTL=24*60*60_000;
export const EVENT_DELIVERY_CLOCK=`
local current=redis.call('GET',KEYS[1])
if not current then
 redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[2],'NX')
 current=redis.call('GET',KEYS[1])
end
return current`;
type Entry={at:number;shared:boolean};
export function createEventDeliveryClock(deps:{atomic:typeof runSharedAtomic;now:()=>number;deadlineMs?:number;report?:(status:string)=>void}){
 const cache=new Map<string,Entry>(),pending=new Map<string,Promise<number>>();
 let pauseUntil=0;
 return async function resolve(event:string,attemptAt:number):Promise<number>{
  if(typeof event!=='string'||!event||event.length>1024||!Number.isSafeInteger(attemptAt)||attemptAt<=0)return attemptAt;
  const now=deps.now();
  // Never let malformed/future input shorten the tier release window.
  if(attemptAt>now||now-attemptAt>=TTL)return attemptAt;
  for(const [key,row] of cache)if(now-row.at>=TTL)cache.delete(key);
  const key='alphaos:event-delivery-clock:v1:'+createHash('sha256').update(event).digest('hex');
  const hit=cache.get(key);
  const candidate=hit?Math.min(hit.at,attemptAt):attemptAt;
  if(hit?.shared)return candidate;
  if(pending.has(key))return pending.get(key)!;
  if(!hit){if(cache.size>=512)cache.delete(cache.keys().next().value!);cache.set(key,{at:candidate,shared:false});}
  if(now<pauseUntil||pending.size>=16)return candidate;
  const job=(async()=>{
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    // One shared operation per event, overlapped with existing preparation.
    // A timed-out operation may still store the same original timestamp.
    const raw=await Promise.race([deps.atomic(EVENT_DELIVERY_CLOCK,[key],[String(candidate),String(TTL)]),
     new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Clock deadline')),deps.deadlineMs??150);})]);
    const at=typeof raw==='string'&&/^\d{1,16}$/.test(raw)?Number(raw):NaN;
    if(!Number.isSafeInteger(at)||at<=0||at>attemptAt||now-at>=TTL)throw Error('Invalid shared clock');
    cache.set(key,{at,shared:true});deps.report?.('SHARED');return at;
   }catch{
    pauseUntil=deps.now()+60_000;deps.report?.('LOCAL_FALLBACK');return candidate;
   }finally{if(timer)clearTimeout(timer);pending.delete(key);}
  })();
  pending.set(key,job);return job;
 };
}
// This is release timing only, not a delivery claim. Redis failure never grants
// send permission; all existing recipient claims and security gates still run.
export const eventDeliveryStartedAt=createEventDeliveryClock({atomic:runSharedAtomic,now:Date.now,
 report:status=>{if(status==='LOCAL_FALLBACK')console.warn('[EventDeliveryClock] LOCAL_FALLBACK restart continuity unavailable for this attempt');}});
