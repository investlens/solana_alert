import {createRecoveryAuditQueue} from './recoveryAuditQueue.js';
import {recordCompactAlert,type CompactAdmission} from './compactAlertOutcomes.js';
import type {PromotionOutcomeBaseline} from './promotionOutcomeBaseline.js';
import {withDatabaseRequestPriority} from './databaseLoadGovernor.js';
import {supabase} from './supabase.js';
type Job={baseline:PromotionOutcomeBaseline;firstAcceptedAt:string;admission?:CompactAdmission};
export function createPromotionOutcomeCapture(deps:{register:typeof recordCompactAlert;save:(job:Job)=>Promise<void>;report:(data:Record<string,unknown>)=>void;now:()=>number}){
 const queue=createRecoveryAuditQueue<Job>({now:deps.now,key:j=>j.baseline.event_identity,
  merge:(a,b)=>Date.parse(a.firstAcceptedAt)<=Date.parse(b.firstAcceptedAt)?a:b,
  write:async job=>{
   const b=job.baseline;
   // Serial admission avoids concurrent promotion attempts losing their tracking
   // slot to another promotion's in-flight registration. The old caps remain.
   if(!job.admission)job.admission=await deps.register({chain:b.chain,token:b.token,feed:b.feed,price:b.price,pair:b.pair_id,
     unit:'USD',marketCap:b.market_cap,liquidity:b.liquidity},1);
   await deps.save(job);
   deps.report({eventIdentity:b.event_identity,reason:b.reason,admission:job.admission});
  },failure:error=>deps.report({status:'DEFERRED',reason:error instanceof Error?error.message:String(error)}),
 });
 return {record:(baseline:PromotionOutcomeBaseline,firstAcceptedAt:string)=>queue.enqueue({baseline,firstAcceptedAt}),stats:queue.stats};
}
const recorder=createPromotionOutcomeCapture({now:Date.now,register:recordCompactAlert,
 save:job=>withDatabaseRequestPriority('BACKGROUND',async()=>{
  const {data,error}=await supabase.rpc('alpha_record_promotion_baseline',{p_baseline:{...job.baseline,first_accepted_at:job.firstAcceptedAt,admission:job.admission}})
    .abortSignal(AbortSignal.timeout(2000));
  if(error)throw error;if(data==='CAPACITY')throw Error('Baseline ledger capacity');
  if(!['RECORDED','EARLIER_ACCEPTANCE_RECORDED','EXISTS'].includes(data))throw Error('Invalid baseline acknowledgement');
 }),report:data=>console.log('[PromotionOutcomeCapture]',JSON.stringify(data)),
});
export const recordPromotionOutcome=(baseline:PromotionOutcomeBaseline,firstAcceptedAt:string)=>recorder.record(baseline,firstAcceptedAt);
