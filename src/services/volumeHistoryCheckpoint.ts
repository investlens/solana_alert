import {getSharedJson,setSharedJson} from './sharedJsonCache.js';
import type {CompletedVolumeWindow} from './volumeBreakoutEvidence.js';
const KEY='alphaos:volume-history:v1';
export type VolumeHistoryCache={expires:number;window:CompletedVolumeWindow|null};
export function restoreVolumeHistory(payload:unknown,now=Date.now()):Map<string,VolumeHistoryCache>{
 const restored=new Map<string,VolumeHistoryCache>(),day=Math.floor(now/86400000),boundary=day*86400000;
 if(!Array.isArray(payload))return restored;
 for(const entry of payload.slice(-100)){
  if(!Array.isArray(entry)||entry.length!==2)continue;
  const [key,value]=entry;const w=value?.window;
  if(typeof key!=='string'||!new RegExp(`^(robinhood|arc):0x[a-f0-9]{40}:0x(?:[a-f0-9]{40}|[a-f0-9]{64}):${day}$`,'i').test(key)
   ||typeof value?.expires!=='number'||value.expires<=now||value.expires>boundary+86400000||!w
   ||![w.dailyAverage,w.signalVolume,w.signalMove,w.dayStart].every(v=>typeof v==='number'&&Number.isFinite(v))
   ||w.dailyAverage<1000||w.signalVolume<0||w.signalMove<=-100||w.dayStart!==boundary-86400000)continue;
  restored.set(key,{expires:value.expires,window:{dailyAverage:w.dailyAverage,signalVolume:w.signalVolume,signalMove:w.signalMove,dayStart:w.dayStart}});
 }
 return restored;
}
export async function readVolumeHistoryCheckpoint(){return restoreVolumeHistory((await getSharedJson<unknown>(KEY))?.value);}
export async function saveVolumeHistoryCheckpoint(history:Map<string,VolumeHistoryCache>){
 const now=Date.now(),expires=(Math.floor(now/86400000)+1)*86400000;
 await setSharedJson(KEY,[...history].filter(([,v])=>v.window!=null&&v.expires>now).slice(-100),new Date(now).toISOString(),expires-now);
}
