import {supabase} from './supabase.js';
type Lookup=(token:string)=>Promise<boolean>;
export function createConfirmedNormalDeliveryLookup(lookup:Lookup,now=Date.now){
 const cache=new Map<string,{confirmed:boolean;until:number}>(),pending=new Map<string,Promise<boolean>>();
 const check=async(token:string)=>{
  const key=token.toLowerCase(),saved=cache.get(key);if(saved&&saved.until>now())return saved.confirmed;
  if(pending.has(key))return pending.get(key)!;
  const work=lookup(key).then(confirmed=>{const accepted=cache.get(key);if(accepted?.confirmed&&accepted.until>now())return true;if(cache.size>=200)cache.delete(cache.keys().next().value!);cache.set(key,{confirmed,until:now()+(confirmed?3600000:300000)});return confirmed;}).finally(()=>pending.delete(key));pending.set(key,work);return work;
 };
 return Object.assign(check,{confirm:(token:string)=>{const key=token.toLowerCase();if(cache.size>=200)cache.delete(cache.keys().next().value!);cache.set(key,{confirmed:true,until:now()+3600000});}});
}
// Reads only when a fresh scanner candidate qualifies with an older marker.
// Failed reads throw; unknown history cannot silently become permission to replay.
export const hasConfirmedNormalOpportunityDelivery=createConfirmedNormalDeliveryLookup(async token=>{
 const deliveries=await supabase.from('opportunity_deliveries').select('id,opportunities!inner(asset_id,chain,strategy_key,recommended_action)')
  .eq('opportunities.chain','robinhood').eq('opportunities.asset_id',token).like('opportunities.strategy_key','EXISTING_TOKEN_%')
  .in('opportunities.recommended_action',['BUY','CHECK_ENTRY'])
  .not('delivered_at','is',null).limit(1).abortSignal(AbortSignal.timeout(2000));
 if(deliveries.error)throw deliveries.error;return !!deliveries.data?.length;
});
