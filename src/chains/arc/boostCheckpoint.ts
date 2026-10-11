import {getSharedJson,setSharedJson} from '../../services/sharedJsonCache.js';
const KEY='alphaos:arc:boost-observation:v1';
// Small observed totals only, expires after one hour; never stores token pages.
export function restoreArcBoostTotals(payload:unknown,now=Date.now()):Map<string,number>{
 const restored=new Map<string,number>();
 if(!payload||typeof payload!=='object')return restored;
 const p=payload as {at?:unknown;totals?:unknown};
 if(typeof p.at!=='number'||now<p.at||now-p.at>5*60000||!Array.isArray(p.totals))return restored;
 for(const entry of p.totals.slice(0,100))if(Array.isArray(entry)&&/^0x[a-f0-9]{40}$/i.test(entry[0])&&typeof entry[1]==='number'&&Number.isFinite(entry[1])&&entry[1]>=0)restored.set(entry[0].toLowerCase(),entry[1]);
 return restored;
}
export async function readArcBoostCheckpoint(){return restoreArcBoostTotals((await getSharedJson<unknown>(KEY))?.value);}
export async function saveArcBoostCheckpoint(totals:Map<string,number>){const at=Date.now();await setSharedJson(KEY,{at,totals:[...totals].slice(-100)},new Date(at).toISOString(),3600000);}
