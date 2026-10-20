import {supabase} from './supabase.js';
import {claimSharedDelivery} from './sharedJsonCache.js';
import {createPrebondResearchStore} from './prebondResearchStore.js';
import {withRequestDeadline,throwIfRequestAborted} from './requestDeadline.js';
import {requestRobinhoodRpcResilient} from '../chains/robinhood/rpc.js';
import {getPonsFactoryDeployments} from '../chains/robinhood/ponsContracts.js';
import {readPrebondResearchQuote} from './prebondResearchQuote.js';
import type {PromotionOutcomeBaseline} from './promotionOutcomeBaseline.js';
const enabled=()=>String(process.env.PREBOND_PROMOTION_RESEARCH_ENABLED??'false').toLowerCase()==='true';
const store=createPrebondResearchStore(supabase,getPonsFactoryDeployments);
let observing=false,running=false,pauseUntil=0;
const quote=(token:string,curve:string)=>withRequestDeadline(4000,()=>readPrebondResearchQuote(token,curve,requestRobinhoodRpcResilient,Date.now,throwIfRequestAborted));
// Called only after durable recording of a confirmed promotion acceptance.
// The new baseline is explicitly a later first observation, never alert price.
export async function observePrebondPromotion(b:PromotionOutcomeBaseline):Promise<void>{
 if(!enabled()||b.reason!=='PRE_BOND_NO_COMPARABLE_DEX_BASELINE'||observing||Date.now()<pauseUntil)return;
 observing=true;
 let phase='ADMISSION_CLAIM';const started=Date.now();
 try{
  if(await claimSharedDelivery(`alphaos:prebond-research:admission:${Math.floor(Date.now()/60000)}`,120_000)!=='CLAIMED')return;
  phase='LAUNCH_LOOKUP';
  const data=await store.lookup(b.token);
  if(!data)return;
  phase='BASELINE_QUOTE';
  const sample=await quote(b.token,data.curve_address);
  if(sample.status!=='MEASURED'){console.log('[PrebondResearch] BASELINE_SKIPPED',sample.reason??sample.status);return;}
  phase='BASELINE_REGISTER';
  const result=await store.register({event_identity:b.event_identity,token:b.token,curve:data.curve_address,
   price:sample.price,at:sample.at,block:sample.block,block_hash:sample.block_hash});
  console.log('[PrebondResearch] ADMISSION',JSON.stringify({eventIdentity:b.event_identity,status:result,unit:'ETH_RESERVE_RATIO',baselineKind:'FIRST_POST_ACCEPTANCE_OBSERVATION'}));
 }catch{pauseUntil=Date.now()+60_000;console.warn('[PrebondResearch] admission unavailable; paused for 60s',{phase,elapsedMs:Date.now()-started});}
 finally{observing=false;}
}
// Consume at most one SPARE checkpoint slot in the existing minute worker.
// No independent timer, runner notifications or shared winner bookkeeping.
export async function runPrebondResearchCycle(spareSlots:number):Promise<void>{
 if(!enabled()||spareSlots<1||running||Date.now()<pauseUntil)return;
 running=true;
 let phase='CHECKPOINT_CLAIM';const started=Date.now();
 try{
  const data=await store.claim();
  const row=data?.[0];if(!row)return;
  phase='CHECKPOINT_QUOTE';
  const sample=await quote(row.token,row.curve);
  phase='CHECKPOINT_FINISH';
  const result=await store.finish(row.event_identity,row.lease,sample);
  console.log('[PrebondResearch] CHECKPOINT',JSON.stringify({eventIdentity:row.event_identity,slot:row.checkpoint,status:sample.status,result}));
 }catch{pauseUntil=Date.now()+60_000;console.warn('[PrebondResearch] checkpoint unavailable; paused for 60s',{phase,elapsedMs:Date.now()-started});}
 finally{running=false;}
}
