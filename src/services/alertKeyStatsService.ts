import { getIndexedVerifiedPonsLaunch } from '../chains/robinhood/ponsLaunchState.js';
import { getVerifiedPonsPublicContext } from '../chains/robinhood/ponsPublicContext.js';
import { withAlertKeyStats, type AlertKeyStats } from '../ui/alertKeyStats.js';
import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
import { readResearchTokenSupply, formatResearchSupply } from './researchTokenSupply.js';
import { fetchRobinhoodPairs } from '../chains/robinhood/market.js';
import { confirmedCurveGraduation, ponsVenueStats } from './ponsAlertVenue.js';
const cache=new Map<string,{at:number;value:AlertKeyStats}>();
const pending=new Map<string,Promise<AlertKeyStats>>();
let started=0,windowAt=0;
export async function discloseRobinhoodKeyStats(text:string,token:string,preBond=false,sellability?:string,lp?:string):Promise<string>{
  const key=token.toLowerCase();let value=cache.get(key);
  if(!value||Date.now()-value.at>30000){
    if(Date.now()-windowAt>=60000){windowAt=Date.now();started=0;}
    let work=pending.get(key);
    if(!work&&pending.size<2&&started<10){
      started++;
      const venue=async()=>{
        const launch=await getIndexedVerifiedPonsLaunch(token);
        if(!launch)return null;
        const c=await getVerifiedPonsPublicContext(token);
        if(!c || (launch.deployer && c.creator.toLowerCase()!==launch.deployer.toLowerCase()))return ponsVenueStats(token,null,null,[]);
        const graduated=c.curveAddress?await confirmedCurveGraduation(token,c.curveAddress):null;
        const pairs=graduated===true && c.poolId ? await fetchRobinhoodPairs(token,{priority:'NORMAL',caller:'alert_pons_venue',queueWaitTimeoutMs:750}).catch(()=>[]) : [];
        return {...ponsVenueStats(token,c,graduated,pairs),supply:formatResearchSupply(c)};
      };
      work=Promise.allSettled([getRobinhoodMarketSnapshot(token,{priority:'NORMAL',caller:'alert_key_stats',queueWaitTimeoutMs:750}),readResearchTokenSupply(token,'robinhood'),venue()]).then(([market,supply,context])=>{
        const m=market.status==='fulfilled'?market.value:null;
        const s=supply.status==='fulfilled'?supply.value:null;
        const c=context.status==='fulfilled'?context.value:null;
        const stats:AlertKeyStats=c?{...c,supply:s?formatResearchSupply(s):c.supply}:{price:m?.priceUsd||null,marketCap:m?.marketCapUsd||null,fdv:m?.fdvUsd||null,liquidity:m?.liquidityUsd||null,
          volume5m:m?.volume5mReported?m.volume5mUsd:null,volume24h:m?.volume24hUsd,move5m:m?.priceChange5m,move1h:m?.priceChange1h,
          buys:m?.trades5mReported?m.buys5m:null,sells:m?.trades5mReported?m.sells5m:null,pairCreatedAt:m?.pairCreatedAt,
          supply:s?formatResearchSupply(s):null,source:m?'DEXScreener'+(s?' / on-chain supply':''):s?'On-chain supply':null,
          checkedAt:m?new Date(m.timestamp).toISOString().slice(11,19):s?.checkedAt.slice(11,19) ?? null};
        if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{at:Date.now(),value:stats});return stats;
      }).finally(()=>pending.delete(key));pending.set(key,work);
    }
    if(work){let timer:ReturnType<typeof setTimeout>|undefined;try{const stats=await Promise.race([work,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),2500);})]);if(stats)value={at:Date.now(),value:stats};}finally{if(timer)clearTimeout(timer);}}
  }
  const ponsHint=preBond || /Trusted PONS|Verified PONS|PONS · Robinchain/i.test(sellability??text);
  const stats=ponsHint && !value?.value.authoritativeVenue ? {authoritativeVenue:true,supply:value?.value.supply,source:'PONS venue data pending',checkedAt:new Date().toISOString().slice(11,19)} : value?.value ?? {};
  return withAlertKeyStats(text,{...stats,preBond:stats.authoritativeVenue?stats.preBond:preBond,sellability,lp});
}
