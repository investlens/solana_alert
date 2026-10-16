import {supabase} from './supabase.js';
import {withRequestDeadline} from './requestDeadline.js';
import {defaultStrategyEnabledForUser} from './strategyService.js';

type Row={telegram_id:string;strategy_key:string;enabled:boolean};
type Reader={registry:(key:string)=>Promise<boolean>;preferences:(users:string[],keys:string[])=>Promise<Row[]>};
const production:Reader={
 registry:async key=>{const {data,error}=await supabase.from('strategy_registry').select('enabled').eq('strategy_key',key).maybeSingle();if(error)throw error;return data?.enabled===true;},
 preferences:async(users,keys)=>{const {data,error}=await supabase.from('user_strategy_preferences').select('telegram_id,strategy_key,enabled').in('telegram_id',users).in('strategy_key',keys);if(error)throw error;return data??[];},
};
// One fresh snapshot per alert. No synthetic membership, stale mute cache, extra
// timers, or changed release clock. Any read failure returns to the existing path.
export async function semanticRecipientPreferences(users:string[],feed:string|null,strategy:string|null,reader:Reader=production):Promise<Map<string,boolean>>{
 const ids=[...new Set(users)],keys=[...new Set([feed,strategy].filter((x):x is string=>!!x))];
 if(ids.length>5000)throw Error('Recipient snapshot budget exceeded');
 if(!keys.length)return new Map(ids.map(id=>[id,true]));
 return withRequestDeadline(4000,async()=>{
  const registry=strategy?reader.registry(strategy):Promise.resolve(true);
  const stored=new Map<string,boolean>();
  // Two read workers, batches of200; never a separate request per recipient.
  let next=0;
  const groups=Array.from({length:Math.ceil(ids.length/200)},(_,i)=>ids.slice(i*200,(i+1)*200));
  const preferences=Promise.all(Array.from({length:Math.min(2,groups.length)},async()=>{
   while(next<groups.length){const group=groups[next++],allowed=new Set(group);
    for(const row of await reader.preferences(group,keys)){
     if(!allowed.has(row.telegram_id)||!keys.includes(row.strategy_key)||typeof row.enabled!=='boolean')throw Error('Invalid preference snapshot');
     const key=JSON.stringify([row.telegram_id,row.strategy_key]);if(stored.has(key))throw Error('Conflicting preference snapshot');stored.set(key,row.enabled);
    }
   }
  }));
  // Both requests are observed, even if one fails, avoiding detached rejections.
  const [enabled]=await Promise.all([registry,preferences]);
  return new Map(ids.map(id=>[id,enabled&&keys.every(key=>stored.get(JSON.stringify([id,key]))??(key===feed?true:defaultStrategyEnabledForUser(key)))]));
 });
}
