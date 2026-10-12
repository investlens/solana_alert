import {getSharedJson,setSharedJson} from '../../services/sharedJsonCache.js';
const KEY='alphaos:arc:pending-boosts:v1';
export type PendingArcBoost={tokenAddress:string;amount:number;totalAmount:number;previous:number;at:number};
export function restorePendingArcBoosts(raw:unknown,now=Date.now()):PendingArcBoost[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(-100).filter(x=>x&&/^0x[a-f0-9]{40}$/i.test(x.tokenAddress)&&[x.amount,x.totalAmount,x.previous,x.at].every(Number.isFinite)&&x.previous>=0&&x.amount>0&&x.totalAmount>x.previous&&now>=x.at&&now-x.at<30*60000);
}
export async function loadPendingArcBoosts(){return restorePendingArcBoosts((await getSharedJson<unknown>(KEY))?.value);}
export async function savePendingArcBoosts(rows:PendingArcBoost[]){const now=Date.now();await setSharedJson(KEY,restorePendingArcBoosts(rows,now),new Date(now).toISOString(),3600000);}
