import {supabase} from './supabase.js';
import {claimSharedDelivery} from './sharedJsonCache.js';
import {withDatabaseRequestPriority} from './databaseLoadGovernor.js';
import {withRequestDeadline,throwIfRequestAborted} from './requestDeadline.js';
import {requestRobinhoodRpcResilient} from '../chains/robinhood/rpc.js';
import {getPonsFactoryDeployments} from '../chains/robinhood/ponsContracts.js';
import {readPrebondResearchQuote} from './prebondResearchQuote.js';
import type {PromotionOutcomeBaseline} from './promotionOutcomeBaseline.js';
const enabled=()=>String(process.env.PREBOND_PROMOTION_RESEARCH_ENABLED??'false').toLowerCase()==='true';
let observing=false,running=false,pauseUntil=0;
const quote=(token:string,curve:string)=>withRequestDeadline(4000,()=>readPrebondResearchQuote(token,curve,requestRobinhoodRpcResilient,Date.now,throwIfRequestAborted));
// Called only after durable recording of a confirmed promotion acceptance.
// The new baseline is explicitly a later first observation, never alert price.
export async function observePrebondPromotion(b:PromotionOutcomeBaseline):Promise<void>{
 if(!enabled()||b.reason!=='PRE_BOND_NO_COMPARABLE_DEX_BASELINE'||observing||Date.now()<pauseUntil)return;
 observing=true;
 try{
  if(await claimSharedDelivery(`alphaos:prebond-research:admission:${Math.floor(Date.now()/60000)}`,120_000)!=='CLAIMED')return;
  await withDatabaseRequestPriority('BACKGROUND',async()=>{
   const {data,error}=await supabase.from('pons_launches').select('token_address,curve_address,factory_address,protocol_version')
    .eq('chain','robinhood').eq('token_address',b.token).limit(1).abortSignal(AbortSignal.timeout(2000)).maybeSingle();
   if(error)throw error;
   if(!data||!getPonsFactoryDeployments().some(f=>f.enabled&&f.generation==='v2'&&f.id===data.protocol_version&&f.address.toLowerCase()===data.factory_address?.toLowerCase())||!data.curve_address)return;
   const sample=await quote(b.token,data.curve_address);
   if(sample.status!=='MEASURED'){console.log('[PrebondResearch] BASELINE_SKIPPED',sample.reason??sample.status);return;}
   const result=await supabase.rpc('alpha_register_prebond_research',{p:{event_identity:b.event_identity,token:b.token,curve:data.curve_address.toLowerCase(),
    price:sample.price,at:sample.at,block:sample.block,block_hash:sample.block_hash}}).abortSignal(AbortSignal.timeout(2000));
   if(result.error)throw result.error;
   console.log('[PrebondResearch] ADMISSION',JSON.stringify({eventIdentity:b.event_identity,status:result.data,unit:'ETH_RESERVE_RATIO',baselineKind:'FIRST_POST_ACCEPTANCE_OBSERVATION'}));
  });
 }catch{pauseUntil=Date.now()+60_000;console.warn('[PrebondResearch] admission unavailable; paused for 60s');}
 finally{observing=false;}
}
// Consume at most one SPARE checkpoint slot in the existing minute worker.
// No independent timer, runner notifications or shared winner bookkeeping.
export async function runPrebondResearchCycle(spareSlots:number):Promise<void>{
 if(!enabled()||spareSlots<1||running||Date.now()<pauseUntil)return;
 running=true;
 try{
  await withDatabaseRequestPriority('BACKGROUND',async()=>{
   const {data,error}=await supabase.rpc('alpha_claim_prebond_research').abortSignal(AbortSignal.timeout(2000));
   if(error)throw error;
   const row=data?.[0];if(!row)return;
   const sample=await quote(row.token,row.curve);
   const result=await supabase.rpc('alpha_finish_prebond_research',{p_event:row.event_identity,p_lease:row.lease,p_sample:sample}).abortSignal(AbortSignal.timeout(2000));
   if(result.error)throw result.error;
   console.log('[PrebondResearch] CHECKPOINT',JSON.stringify({eventIdentity:row.event_identity,slot:row.checkpoint,status:sample.status,result:result.data}));
  });
 }catch{pauseUntil=Date.now()+60_000;console.warn('[PrebondResearch] checkpoint unavailable; paused for 60s');}
 finally{running=false;}
}
