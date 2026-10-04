import { recordFeedDelivery } from './feedDeliveryHealth.js';
import { getUserStrategyPreferences, setUserStrategyEnabled } from './strategyService.js';
import { getSharedJson, setSharedJson } from './sharedJsonCache.js';

export const LIVE_ALERT_FEEDS = [
  {key:'RH_BOOST', chain:'Robinchain / PONS', name:'Boost', description:'New or increased token promotion.'},
  {key:'DEX_PAID', chain:'Robinchain / PONS', name:'DEX Paid', description:'New DexScreener payment event; no market-cap/token-age limit.'},
  {key:'RH_SOCIAL_MAFIA', chain:'Robinchain / PONS', name:'Social Mafia', description:'Verified launchpad and exact contract publication on X.'},
  {key:'RH_PROTOCOL_DISCOVERY', chain:'Robinchain / PONS', name:'Protocol Discovery', description:'Protocol-named PONS projects with X + Telegram links.'},
  {key:'RH_TRADE_SETUP', chain:'Robinchain / PONS', name:'Trade Setup', description:'Confirmed recovery or breakout with fresh creator evidence.'},
  {key:'RH_MOMENTUM', chain:'Robinchain / PONS', name:'PONS Momentum', description:'Qualified curve or indexed-market momentum and follow-ups.'},
  {key:'RH_SUPPLY_BURN', chain:'Robinchain / PONS', name:'Supply Burn', description:'Verified burn meeting the feed checks.'},
  {key:'ARC_DEX_PAID', chain:'ARC', name:'DEX Paid', description:'Fresh promotion payment; mandatory sellability evidence.'},
  {key:'ARC_BOOST', chain:'ARC', name:'Boost', description:'Promotion with mandatory sellability evidence.'},
  {key:'ARC_OPPORTUNITY', chain:'ARC', name:'Opportunity', description:'Market conditions with mandatory sellability evidence.'},
  {key:'ARC_SUPPLY_BURN', chain:'ARC', name:'Supply Burn', description:'Verified burn with mandatory sellability evidence.'},
] as const;
export type LiveFeedKey = typeof LIVE_ALERT_FEEDS[number]['key'];
type Preferences = Record<LiveFeedKey, boolean>;
const local = new Map<string,{value:Preferences;at:number}>();
const pending = new Map<string,Promise<Preferences>>();
const failedUntil = new Map<string,number>();
export function isLiveFeedKey(key:string): key is LiveFeedKey { return LIVE_ALERT_FEEDS.some(feed=>feed.key===key); }
export function resolveLivePreferences(stored:Map<string,boolean>): Preferences {
  return Object.fromEntries(LIVE_ALERT_FEEDS.map(feed=>[feed.key,stored.get(feed.key) ?? true])) as Preferences;
}
function remember(user:string,value:Preferences) {
  local.delete(user);local.set(user,{value,at:Date.now()});
  while(local.size>5000) local.delete(local.keys().next().value!);
}
export async function liveAlertPreferences(user:string):Promise<Preferences> {
  const cached=local.get(user);if(cached && Date.now()-cached.at<15_000)return cached.value;
  if(pending.has(user))return pending.get(user)!;
  const work=(async()=>{
    const saved=await getSharedJson<Preferences>(`alphaos:feed-preferences:${user}`);
    if(saved && LIVE_ALERT_FEEDS.every(feed=>typeof saved.value?.[feed.key]==='boolean')) {remember(user,saved.value);return saved.value;}
    if((failedUntil.get(user)??0)>Date.now())throw new Error('Preferences temporarily unavailable');
    try {
      const value=resolveLivePreferences(await getUserStrategyPreferences(user));
      await setSharedJson(`alphaos:feed-preferences:${user}`,value,new Date().toISOString(),60_000);
      remember(user,value);failedUntil.delete(user);return value;
    } catch(error){failedUntil.set(user,Date.now()+60_000);while(failedUntil.size>5000)failedUntil.delete(failedUntil.keys().next().value!);throw error;}
  })();pending.set(user,work);try{return await work;}finally{pending.delete(user);}
}
export async function liveFeedEnabled(user:string,key:LiveFeedKey):Promise<boolean> {
  try { const enabled=(await liveAlertPreferences(user))[key]; recordFeedDelivery(key,enabled?'ENABLED':'MUTED'); return enabled; }
  catch { recordFeedDelivery(key,'PREFERENCES_UNAVAILABLE'); return false; }
}
const changing = new Set<string>();
export async function toggleLiveFeed(user:string,key:LiveFeedKey):Promise<boolean> {
  if(changing.has(user))throw new Error('Preference update in progress');
  changing.add(user);try {
  const current=await liveAlertPreferences(user);const enabled=!current[key];
  await setUserStrategyEnabled({telegramId:user,strategyKey:key,enabled});
  const next={...current,[key]:enabled};
  await setSharedJson(`alphaos:feed-preferences:${user}`,next,new Date().toISOString(),60_000);
  remember(user,next);return enabled;
  } finally {changing.delete(user);}
}
export async function enabledLiveRecipients(users:string[],key:LiveFeedKey, check=liveFeedEnabled):Promise<string[]> {
  const flags=await Promise.all(users.map(user=>check(user,key)));
  return users.filter((_,index)=>flags[index]);
}
export function semanticLiveFeed(type:string,chain:string):LiveFeedKey|null {
  if(chain!=='robinhood' && chain!=='pons')return null;
  if(type==='DEX_PAID')return 'DEX_PAID';
  if(/BOOST/.test(type))return 'RH_BOOST';
  if(['DEV_BURN','VERIFIED_BURN'].includes(type))return 'RH_SUPPLY_BURN';
  return null;
}
