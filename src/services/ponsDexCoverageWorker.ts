import {createDexCoverageWorker,verifyDexCoverage,type DexCoverageCandidate} from './ponsDexCoverage.js';
import {getVerifiedPonsPublicContext,getPonsV1PoolMapping} from '../chains/robinhood/ponsPublicContext.js';
import {confirmedCurveGraduation} from './ponsAlertVenue.js';
import {fetchRobinhoodPairs} from '../chains/robinhood/market.js';
import {runDatabaseWork,canStartDatabaseWork} from './databaseLoadGovernor.js';
import {withRequestDeadline,currentRequestSignal} from './requestDeadline.js';
import {getWatchCheckpoint,setWatchCheckpoint,claimSharedDelivery} from './sharedJsonCache.js';
import {supabase} from './supabase.js';

const KEY='alphaos:pons:dex-coverage:v1';
const creators=new Map<string,{exclude:string;after:number}>();
// A hint only; never a creator success claim or a reason to send an alert.
export function queueDexCoverageCreator(creator:string,token:string):void{
 if(!/^0x[a-f0-9]{40}$/i.test(creator))return;
 const prior=creators.get(creator.toLowerCase());creators.delete(creator.toLowerCase());
 creators.set(creator.toLowerCase(),{exclude:token.toLowerCase(),after:prior?.after??0});
 while(creators.size>20)creators.delete(creators.keys().next().value!);
}
const fields='token_address,deployer_address,factory_address,curve_address,protocol_version,block_number';
const worker=createDexCoverageWorker({
 now:Date.now,
 claim:async()=>canStartDatabaseWork('BACKGROUND')&&await claimSharedDelivery(`${KEY}:minute:${Math.floor(Date.now()/60000)}`,120000)==='CLAIMED',
 restore:async()=>(await getWatchCheckpoint(KEY))?.value??null,
 checkpoint:value=>setWatchCheckpoint(KEY,value,new Date().toISOString(),7*86400000),
 load:()=>runDatabaseWork('BACKGROUND',()=>withRequestDeadline(6000,async()=>{
  // Existing compact records are already capped/retained by the outcome subsystem.
  // Read at most 160; no census-wide token scan or raw transaction retention.
  const {data:tracked,error}=await supabase.from('alpha_compact_tracking').select('token,price_unit,started_at')
   .eq('chain','robinhood').order('price_unit',{ascending:false}).order('started_at',{ascending:false}).limit(160);
  if(error)throw error;
  const tokens=[...new Set((tracked??[]).map(x=>x.token))];
  const indexed=tokens.length?await supabase.from('pons_launches').select(fields).eq('chain','robinhood').eq('protocol','pons').in('token_address',tokens).limit(160):{data:[],error:null};
  if(indexed.error)throw indexed.error;
  const rows=(indexed.data??[]) as DexCoverageCandidate[];
  const hint=creators.entries().next().value;
  if(hint){const [creator,state]=hint;
   const prior=await supabase.from('pons_launches').select(`${fields},id`).eq('chain','robinhood').eq('protocol','pons')
    .eq('deployer_address',creator).neq('token_address',state.exclude).gt('id',state.after).order('id').limit(32);
   if(prior.error)throw prior.error;
   rows.unshift(...prior.data??[]);
   creators.delete(creator);if(prior.data?.length===32)creators.set(creator,{...state,after:Number(prior.data[31].id)});
  }
  const unique=[...new Map(rows.map(x=>[x.token_address,x])).values()].slice(0,192);
  if(!unique.length)return [];
  const known=await supabase.from('alpha_pons_dex_reached').select('token').eq('chain','robinhood').in('token',unique.map(x=>x.token_address));
  if(known.error)throw known.error;const completed=new Set(known.data?.map(x=>x.token));
  return unique.filter(x=>!completed.has(x.token_address));
 })),
 verify:c=>withRequestDeadline(8000,()=>verifyDexCoverage(c,{
  context:getVerifiedPonsPublicContext,graduated:confirmedCurveGraduation,v1Pool:getPonsV1PoolMapping,now:Date.now,
  pairs:token=>fetchRobinhoodPairs(token,{priority:'NORMAL',caller:'pons_dex_coverage',queueWaitTimeoutMs:750,signal:currentRequestSignal()}),
 })),
 save:async items=>{
  const result=await runDatabaseWork('BACKGROUND',async()=>{
   const {data,error}=await supabase.rpc('alpha_record_pons_dex_reached',{p_items:items}).abortSignal(AbortSignal.timeout(4000));
   if(error)throw error;return data;
  });if(result===null)throw Error('Evidence persistence deferred');return Number(result);
 },
 report:stats=>console.log('[PonsDexCoverage]',stats),
});
export async function runPonsDexCoverage():Promise<void>{
 if(process.env.PONS_DEX_COVERAGE_ENABLED==='false')return;
 await worker.tick();
}
