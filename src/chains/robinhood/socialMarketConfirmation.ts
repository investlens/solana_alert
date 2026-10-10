import type { AlertKeyStats } from '../../ui/alertKeyStats.js';

export const SOCIAL_CONFIRMATION_SPACING_MS = 120_000;
export type SocialMarketObservation = { at:number; price:number; depth:number; venue:string; identity:string };

export function createSocialIdentityTracker(limit=500) {
  const tokens=new Map<string,{handle:string;expires:number}>();
  return {
    observe(token:string,handle:string,expires:number,now=Date.now()):boolean {
      for(const [key,value] of tokens)if(value.expires<=now)tokens.delete(key);
      const key=token.toLowerCase(), identity=handle.toLowerCase();
      if(!tokens.has(key)&&tokens.size>=limit)tokens.delete(tokens.keys().next().value!);
      tokens.set(key,{handle:identity,expires});
      return [...tokens].some(([other,value])=>other!==key&&value.handle===identity);
    },
    clear(){tokens.clear();},
  };
}

// checkedAt is UTC source time, not the time a recipient opens the card.
// Resolve midnight without treating an observation from tomorrow as fresh.
export function socialMarketObservedAt(stats:AlertKeyStats, now:number):number|null {
  const match=stats.checkedAt?.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if(!match)return null;
  const [hour,minute,second]=match.slice(1).map(Number);
  if(hour>23||minute>59||second>59)return null;
  const day=Math.floor(now/86_400_000)*86_400_000;
  let at=day+(hour*3600+minute*60+second)*1000;
  if(at>now)at-=86_400_000;
  return now-at<=90_000?at:null;
}

export function confirmSocialMarket(stats:AlertKeyStats, previous:SocialMarketObservation|undefined,
  identity:string, now=Date.now(), dexObservedAt?:number):{
    ready:boolean; reason:string; observation?:SocialMarketObservation;
  } {
  const sourceAt=socialMarketObservedAt(stats,now);
  if(stats.preBond!==true&&(dexObservedAt==null||!Number.isFinite(dexObservedAt)
    ||dexObservedAt>now||now-dexObservedAt>90_000))
    return {ready:false,reason:'FRESH_COMPARABLE_MARKET_UNAVAILABLE'};
  const at=stats.preBond===true?sourceAt:sourceAt!=null&&dexObservedAt!=null?Math.min(sourceAt,dexObservedAt):null;
  const depth=stats.preBond===true?stats.curveReserve:stats.liquidity;
  const venue=stats.preBond===true?'PONS_CURVE':stats.chartUrl;
  if(at==null||!Number.isFinite(at)||at>now||now-at>90_000||!venue
    ||!Number.isFinite(stats.price)||stats.price!<=0||!Number.isFinite(depth)||depth!<=0)
    return {ready:false,reason:'FRESH_COMPARABLE_MARKET_UNAVAILABLE'};
  const observation={at,price:stats.price!,depth:depth!,venue,identity};
  if(!previous||previous.venue!==venue||previous.identity!==identity||now-previous.at>300_000)
    return {ready:false,reason:'SECOND_MARKET_CHECK_REQUIRED',observation};
  if(at-previous.at<SOCIAL_CONFIRMATION_SPACING_MS)
    return {ready:false,reason:'SPACED_MARKET_CHECK_REQUIRED',observation:previous};
  if(observation.price<previous.price||observation.depth<previous.depth)
    return {ready:false,reason:'PRICE_OR_DEPTH_DECLINED'};
  return {ready:true,reason:'ACTIVITY_SUSTAINED_ACROSS_TWO_CHECKS',observation};
}
