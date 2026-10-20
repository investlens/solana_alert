import type {SupabaseClient} from '@supabase/supabase-js';
import {withDatabaseRequestPriority} from './databaseLoadGovernor.js';
import {currentRequestSignal,throwIfRequestAborted,withRequestDeadline} from './requestDeadline.js';
import type {PonsFactoryDeployment} from '../chains/robinhood/ponsContracts.js';
import type {CurveObservation} from './prebondResearchQuote.js';

const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[a-f0-9]{40}$/i.test(v)&&!/^0x0{40}$/i.test(v);
export type ResearchLaunch={token_address:string;curve_address:string;factory_address:string;protocol_version:string};
// Await the lazy PostgREST builder INSIDE both scopes. An expired request must
// fail rather than escape its background lane or accept a late cached response.
export function createPrebondResearchStore(client:SupabaseClient,factories:()=>PonsFactoryDeployment[],deadlineMs=2000){
 async function request<T>(work:(signal:AbortSignal)=>Promise<{data:T;error:unknown}>):Promise<T>{
  throwIfRequestAborted();
  return withDatabaseRequestPriority('BACKGROUND',()=>withRequestDeadline(deadlineMs,async()=>{
   throwIfRequestAborted();
   const result=await work(currentRequestSignal()!);
   throwIfRequestAborted();
   if(result.error)throw Error('RESEARCH_DATABASE_UNAVAILABLE');
   return result.data;
  }));
 }
 return {
  async lookup(token:string):Promise<ResearchLaunch|null>{
   if(!address(token))return null;
   const canonical=token.toLowerCase();
   const rows=await request(async signal=>await client.from('pons_launches')
    .select('token_address,curve_address,factory_address,protocol_version,protocol')
    .eq('chain','robinhood').eq('token_address',canonical).eq('protocol','pons').limit(2).abortSignal(signal).retry(false));
   // Never select an arbitrary first launch when provenance is ambiguous.
   if(!rows||rows.length!==1)return null;
   const row=rows[0];
   if(row.protocol!=='pons'||row.token_address!==canonical||!address(row.curve_address)||row.curve_address.toLowerCase()===canonical||
    !factories().some(f=>f.enabled&&f.generation==='v2'&&f.id===row.protocol_version&&f.address.toLowerCase()===row.factory_address?.toLowerCase()))return null;
   return {token_address:canonical,curve_address:row.curve_address.toLowerCase(),factory_address:row.factory_address.toLowerCase(),protocol_version:row.protocol_version};
  },
  register(p:Record<string,unknown>){return request(async signal=>await client.rpc('alpha_register_prebond_research',{p}).abortSignal(signal).retry(false));},
  claim(){return request(async signal=>await client.rpc('alpha_claim_prebond_research').abortSignal(signal).retry(false));},
  finish(event:string,lease:string,sample:CurveObservation){
   return request(async signal=>await client.rpc('alpha_finish_prebond_research',{p_event:event,p_lease:lease,p_sample:sample}).abortSignal(signal).retry(false));
  },
 };
}
