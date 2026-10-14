import {createHash} from 'node:crypto';
export type PromotionAuditStage='OBSERVED'|'WATCHED'|'BLOCKED'|'READY'|'DELIVERY_PENDING'|'DELIVERED'|'EXPIRED';
export type PromotionAuditEntry={id:string;feed:string;stage:PromotionAuditStage;firstAt:number;updatedAt:number};
export type PromotionAuditSnapshot={startedAt:number;observedAt:number;limit:number;windowMs:number;capacityEvicted:number;expired:number;entries:PromotionAuditEntry[]};
const stages=new Set<PromotionAuditStage>(['OBSERVED','WATCHED','BLOCKED','READY','DELIVERY_PENDING','DELIVERED','EXPIRED']);
// Unique observed promotions only, with opaque identities and no recipient data.
// This is a bounded diagnostic window, never an exhaustive upstream census.
export function createPromotionEventAudit(limit=128,windowMs=3_600_000,startedAt=Date.now()) {
 const rows=new Map<string,PromotionAuditEntry>();let capacityEvicted=0,expired=0,observedAt=startedAt;
 const prune=(now:number)=>{for(const [id,row]of rows)if(now-row.firstAt>windowMs){rows.delete(id);expired++;}};
 return {
  record(feed:string,identity:string,stage:PromotionAuditStage,now=Date.now()){
   if(!/^[A-Z_]{2,40}$/.test(feed)||!identity||identity.length>256||!stages.has(stage)||!Number.isFinite(now)||now<startedAt)return false;
   prune(now);const id=createHash('sha256').update(`${feed}:${identity}`).digest('hex').slice(0,24);const prior=rows.get(id);
   // Re-observation is not another purchase and cannot erase its outcome.
   if(prior&&(stage==='OBSERVED'||prior.stage==='DELIVERED'))return false;
   if(!prior&&rows.size>=limit){rows.delete(rows.keys().next().value!);capacityEvicted++;}
   observedAt=now;rows.set(id,{id,feed,stage,firstAt:prior?.firstAt??now,updatedAt:now});return true;
  },
  snapshot(now=Date.now()):PromotionAuditSnapshot{prune(now);return {startedAt,observedAt,limit,windowMs,capacityEvicted,expired,entries:[...rows.values()].map(row=>({...row}))};},
 };
}
