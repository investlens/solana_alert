import type {AlertKeyStats} from '../ui/alertKeyStats.js';
import {runDatabaseWork} from './databaseLoadGovernor.js';
export type DexReached={token:string;pool:string;source:'PONS_V2_GRADUATED_MAPPED_POOL'|'PONS_V1_MAPPED_POOL';observed_at:string};
export function verifiedDexReached(token:string,stats:AlertKeyStats,now:number):DexReached|null{
 if(!/^0x[a-f0-9]{40}$/i.test(token)||!stats.authoritativeVenue||stats.preBond!==false||!Number.isFinite(stats.price)||stats.price!<=0||!Number.isFinite(stats.liquidity)||stats.liquidity!<=0)return null;
 const source=stats.source==='DEXScreener · PONS-mapped graduated pool'?'PONS_V2_GRADUATED_MAPPED_POOL':stats.source==='DEXScreener · PONS V1 mapped pool'?'PONS_V1_MAPPED_POOL':null;
 const pool=stats.chartUrl?.match(/^https:\/\/dexscreener\.com\/robinhood\/(0x(?:[a-f0-9]{40}|[a-f0-9]{64}))$/i)?.[1]?.toLowerCase();
 if(!source||!pool||pool===token.toLowerCase()||/^0x0+$/.test(pool))return null;
 return {token:token.toLowerCase(),pool,source,observed_at:new Date(now).toISOString()};
}
export function createDexReachedRecorder(deps:{now:()=>number;save:(items:DexReached[])=>Promise<unknown>}){
 const queue=new Map<string,DexReached>(),seen=new Map<string,number>();let active=false,next=0;
 async function flush(){if(active||deps.now()<next||!queue.size)return;active=true;next=deps.now()+60000;
  const batch=[...queue.values()].filter(x=>deps.now()-Date.parse(x.observed_at)<=300000).slice(0,10);
  try{if(batch.length)await deps.save(batch);for(const x of batch){queue.delete(x.token);if(seen.size>=1000)seen.delete(seen.keys().next().value!);seen.set(x.token,deps.now());}}
  catch{/* Evidence remains uncounted until persistence succeeds; alerts never wait. */}
  finally{active=false;for(const [key,x] of queue)if(deps.now()-Date.parse(x.observed_at)>300000)queue.delete(key);}
 }
 return {observe(token:string,stats:AlertKeyStats){const now=deps.now(),proof=verifiedDexReached(token,stats,now);if(!proof||now-(seen.get(proof.token)??-Infinity)<86400000)return;if(queue.size>=50&&!queue.has(proof.token))return;queue.set(proof.token,proof);void flush();},flush,stats:()=>({pending:queue.size,active})};
}
const recorder=createDexReachedRecorder({now:Date.now,save:items=>runDatabaseWork('BACKGROUND',async()=>{
 const {supabase}=await import('./supabase.js');const {data,error}=await supabase.rpc('alpha_record_pons_dex_reached',{p_items:items}).abortSignal(AbortSignal.timeout(4000));if(error)throw error;return data;
}).then(result=>{if(result===null)throw Error('Dex evidence deferred');return result;})});
export const observeVerifiedPonsDex=(token:string,stats:AlertKeyStats)=>recorder.observe(token,stats);
export const flushVerifiedPonsDex=()=>recorder.flush();
