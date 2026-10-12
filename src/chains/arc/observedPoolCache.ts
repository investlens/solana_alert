import {getSharedJson,setSharedJson} from '../../services/sharedJsonCache.js';
import type {ArcObservedPoolMetadata} from './observedSelling.js';
const KEY='alphaos:arc:verified-pool-metadata:v1';
type Entry={pool:string;token:string;at:number;metadata:ArcObservedPoolMetadata};
export async function cacheArcPoolMetadata(pool:string,token:string,metadata:ArcObservedPoolMetadata){
 const rows=(await getSharedJson<Entry[]>(KEY))?.value??[];
 const now=Date.now();const retained=rows.filter(x=>x.pool.toLowerCase()!==pool.toLowerCase()&&now-x.at<8*3600000).slice(-99);
 await setSharedJson(KEY,[...retained,{pool,token,at:now,metadata}],new Date(now).toISOString(),8*3600000);
}
export async function cachedArcPoolMetadata(pool:string,token:string){
 const rows=(await getSharedJson<Entry[]>(KEY))?.value??[];
 return rows.find(x=>x.pool.toLowerCase()===pool.toLowerCase()&&x.token.toLowerCase()===token.toLowerCase()&&Date.now()>=x.at&&Date.now()-x.at<8*3600000)?.metadata;
}
