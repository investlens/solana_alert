import {getSharedJson,setSharedJson} from '../../services/sharedJsonCache.js';
export type PendingBoost={tokenAddress:string;amount:number;totalAmount:number;previousTotal:number|null;firstAt:number};
const KEY='alphaos:robinhood:pending-boosts:v1';
export function restorePendingBoosts(raw:unknown,now=Date.now()):PendingBoost[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(-100).filter(x=>x&&/^0x[a-f0-9]{40}$/i.test(x.tokenAddress)&&[x.amount,x.totalAmount,x.firstAt].every(Number.isFinite)&&x.amount>0&&x.totalAmount>=x.amount&&(x.previousTotal===null||Number.isFinite(x.previousTotal)&&x.previousTotal>=0&&x.previousTotal<x.totalAmount)&&now>=x.firstAt&&now-x.firstAt<30*60000);
}
export async function loadPendingBoosts(){return restorePendingBoosts((await getSharedJson<unknown>(KEY))?.value);}
export async function savePendingBoosts(rows:PendingBoost[]){const now=Date.now();await setSharedJson(KEY,restorePendingBoosts(rows,now),new Date(now).toISOString(),3600000);}
