import { readRobinhoodTokenIdentity, type TokenIdentity } from './researchTokenIdentity.js';
import { getIndexedVerifiedPonsLaunch, getPonsLaunchState } from '../chains/robinhood/ponsLaunchState.js';
import { getVerifiedPonsPublicContext, getPonsV1PoolMapping } from '../chains/robinhood/ponsPublicContext.js';
import { withAlertKeyStats, type AlertKeyStats } from '../ui/alertKeyStats.js';
import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
import { readResearchTokenSupply, formatResearchSupply } from './researchTokenSupply.js';
import { fetchRobinhoodPairs } from '../chains/robinhood/market.js';
import { confirmedCurveGraduation, ponsVenueStats, ponsV1VenueStats } from './ponsAlertVenue.js';
import { selectAlertMarket } from './alertMarketSelection.js';
import type { ChainMarketSnapshot } from '../chains/shared/types.js';
const cache=new Map<string,{at:number;value:AlertKeyStats}>();
const pending=new Map<string,Promise<AlertKeyStats>>();
let started=0,windowAt=0;
export async function discloseRobinhoodKeyStats(text:string,token:string,preBond=false,sellability?:string,lp?:string,refresh=false):Promise<string>{
  const ponsHint=preBond || /Trusted PONS|Verified PONS|PONS · Robinchain/i.test(sellability??text);
  const key=token.toLowerCase();let value=cache.get(key);
  if(refresh||!value||Date.now()-value.at>30000){
    if(Date.now()-windowAt>=60000){windowAt=Date.now();started=0;}
    let work=pending.get(key);
    if(!work&&pending.size<2&&started<10){
      started++;
      let observedMarket:ChainMarketSnapshot|null=null;
      let identity:TokenIdentity={};
      let observedVenue:AlertKeyStats|null=preBond?{preBond:true,authoritativeVenue:true}:null;
      const publish=(venue:AlertKeyStats|null)=>{
        observedVenue=venue;
        const selected=selectAlertMarket(token,venue,observedMarket);
        const stats={...selected,name:selected.name??identity.name,symbol:selected.symbol??identity.symbol};
        if(cache.size>=100)cache.delete(cache.keys().next().value!);
        cache.set(key,{at:Date.now(),value:stats});
        return stats;
      };
      const identityWork=readRobinhoodTokenIdentity(token).then(value=>{identity=value;publish(observedVenue);return value;});
      const marketWork=getRobinhoodMarketSnapshot(token,{priority:'NORMAL',caller:'alert_key_stats',queueWaitTimeoutMs:750}).then(m=>{
        observedMarket=m;publish(observedVenue);return m;
      });
      const venue=async()=>{
        // Independent reads start together; slow index lookups must not postpone the public page request.
        const publicWork=ponsHint ? getVerifiedPonsPublicContext(token).then(context=>{
          // Exact-token, enabled-factory public metadata is independent of the index.
          // Quote is explicitly unconfirmed until the venue read completes.
          if(context)publish({...ponsVenueStats(token,context,null,[]),supply:formatResearchSupply(context)});
          return context;
        }).catch(()=>null) : Promise.resolve(null);
        const [indexedLaunch,publicContext]=await Promise.all([getIndexedVerifiedPonsLaunch(token).catch(()=>null),publicWork]);
        let launch=indexedLaunch;
        // A verified V2 origin can exist before the durable launch index catches up.
        // Reuse exact-contract public metadata before the V1-only fallback.

        if(publicContext && (!launch?.deployer || publicContext.creator.toLowerCase()===launch.deployer.toLowerCase())) {
          // Identity/supply remain useful even when the on-chain venue read hits its deadline.
          publish({...ponsVenueStats(token,publicContext,null,[]),supply:formatResearchSupply(publicContext)});
          const graduated=publicContext.curveAddress ? await confirmedCurveGraduation(token,publicContext.curveAddress):null;
          const pairs=graduated===true&&publicContext.poolId ? await fetchRobinhoodPairs(token,{priority:'NORMAL',caller:'alert_pons_venue',queueWaitTimeoutMs:750}).catch(()=>[]):[];
          return {...ponsVenueStats(token,publicContext,graduated,pairs),supply:formatResearchSupply(publicContext)};
        }
        // Older launches may predate our index. Reuse the bounded cached factory
        // read, without a second database lookup or broad event-log replay.
        if (!launch && ponsHint) {
          const direct = await getPonsLaunchState(token,{skipIndexedLookup:true}).catch(()=>null);
          if (direct?.exists && direct.token.toLowerCase()===token.toLowerCase()) {
            launch={exists:true,token:direct.token,deployer:direct.deployer,generation:'v1'};
          }
        }
        if(!launch)return null;
        if (launch.generation === 'v1' && launch.deployer) {
          const pool = await getPonsV1PoolMapping(token, launch.deployer);
          if (!pool) return {...ponsVenueStats(token,null,null,[]),creator:launch.deployer};
          const pairs = await fetchRobinhoodPairs(token,{priority:'NORMAL',caller:'alert_pons_venue',queueWaitTimeoutMs:750}).catch(()=>[]);
          return {...ponsV1VenueStats(token,pool,pairs),creator:launch.deployer};
        }
        const c=await getVerifiedPonsPublicContext(token);
        if(!c || (launch.deployer && c.creator.toLowerCase()!==launch.deployer.toLowerCase()))return {...ponsVenueStats(token,null,null,[]),creator:launch.deployer};
        const graduated=c.curveAddress?await confirmedCurveGraduation(token,c.curveAddress):null;
        const pairs=graduated===true && c.poolId ? await fetchRobinhoodPairs(token,{priority:'NORMAL',caller:'alert_pons_venue',queueWaitTimeoutMs:750}).catch(()=>[]) : [];
        return {...ponsVenueStats(token,c,graduated,pairs),supply:formatResearchSupply(c)};
      };
      const venueWork=venue().then(stats=>{
        // Slow independent supply reads must not hide an already verified market.
        if(stats)publish(stats);
        return stats;
      });
      work=Promise.allSettled([marketWork,readResearchTokenSupply(token,'robinhood'),venueWork,identityWork]).then(([market,supply,context])=>{
        const m=market.status==='fulfilled'?market.value:null;
        const s=supply.status==='fulfilled'?supply.value:null;
        const c=context.status==='fulfilled'?context.value:observedVenue;
        const stats:AlertKeyStats=ponsHint||c?{...selectAlertMarket(token,c??(preBond?{preBond:true,authoritativeVenue:true}:null),m),supply:s?formatResearchSupply(s):c?.supply}:{name:m?.name,symbol:m?.symbol,chartUrl:m?.chartUrl,price:m?.priceUsd||null,marketCap:m?.marketCapUsd||null,fdv:m?.fdvUsd||null,liquidity:m?.liquidityUsd||null,
          volume5m:m?.volume5mReported?m.volume5mUsd:null,volume24h:m?.volume24hUsd,move5m:m?.priceChange5m,move1h:m?.priceChange1h,
          buys:m?.trades5mReported?m.buys5m:null,sells:m?.trades5mReported?m.sells5m:null,pairCreatedAt:m?.pairCreatedAt,
          supply:s?formatResearchSupply(s):null,source:m?'DEXScreener'+(s?' / on-chain supply':''):s?'On-chain supply':null,
          checkedAt:m?new Date(m.timestamp).toISOString().slice(11,19):s?.checkedAt.slice(11,19) ?? null};
        stats.name??=identity.name;stats.symbol??=identity.symbol;
        if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{at:Date.now(),value:stats});return stats;
      }).finally(()=>pending.delete(key));pending.set(key,work);
    }
    if(work){let timer:ReturnType<typeof setTimeout>|undefined;try{const stats=await Promise.race([work,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),2500);})]);if(stats)value={at:Date.now(),value:stats};}finally{if(timer)clearTimeout(timer);}}
    value=cache.get(key)??value;
  }
  const stats=ponsHint && !value?.value.authoritativeVenue ? {authoritativeVenue:true,name:value?.value.name,symbol:value?.value.symbol,twitter:value?.value.twitter,telegram:value?.value.telegram,creator:value?.value.creator,supply:value?.value.supply,source:'PONS venue data pending',checkedAt:new Date().toISOString().slice(11,19)} : value?.value ?? {};
  return withAlertKeyStats(text,{...stats,preBond:stats.authoritativeVenue?stats.preBond:preBond,sellability,lp});
}

// Read only; the bounded enrichment above owns provider work and expiry.
export function cachedRobinhoodAlertStats(token:string):AlertKeyStats|null {
 const saved=cache.get(token.toLowerCase());
 return saved && Date.now()-saved.at<=30000 ? {...saved.value}:null;
}
