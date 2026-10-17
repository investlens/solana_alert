import type {AlertKeyStats} from '../ui/alertKeyStats.js';
export type PromotionBaselineReason='VERIFIED_EXACT_PAIR'|'PRE_BOND_NO_COMPARABLE_DEX_BASELINE'|'NO_RENDERED_STATS'|'UNVERIFIED_MARKET_SOURCE'|'EXACT_PAIR_UNAVAILABLE'|'PRICE_UNAVAILABLE'|'CHECKED_POOL_MISMATCH';
export type PromotionOutcomeBaseline={event_identity:string;chain:'robinhood';token:string;feed:'BOOST'|'DEX_PAID';captured_at:string;reason:PromotionBaselineReason;
 price:number|null;pair_id:string|null;price_unit:'USD'|null;market_cap:number|null;liquidity:number|null;quote_source:string|null};
const positive=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
export function capturePromotionOutcomeBaseline(args:{eventIdentity:string;token:string;feed:'BOOST'|'DEX_PAID';stats:AlertKeyStats|null;expectedPair?:string;now?:number}):PromotionOutcomeBaseline{
 const s=args.stats;
 let reason:PromotionBaselineReason='VERIFIED_EXACT_PAIR';
 const pair=s?.chartUrl?.match(/^https:\/\/dexscreener\.com\/robinhood\/(0x(?:[a-f0-9]{40}|[a-f0-9]{64}))(?:[?#][^\s]*)?$/i)?.[1]?.toLowerCase()??null;
 if(!s)reason='NO_RENDERED_STATS';
 else if(s.preBond===true)reason='PRE_BOND_NO_COMPARABLE_DEX_BASELINE';
 else if(!s.source?.includes('DEXScreener'))reason='UNVERIFIED_MARKET_SOURCE';
 else if(!pair||pair===args.token.toLowerCase()||/^0x0+$/.test(pair))reason='EXACT_PAIR_UNAVAILABLE';
 else if(args.expectedPair&&args.expectedPair.toLowerCase()!==pair)reason='CHECKED_POOL_MISMATCH';
 else if(positive(s.price)===null)reason='PRICE_UNAVAILABLE';
 const comparable=reason==='VERIFIED_EXACT_PAIR';
 return {event_identity:args.eventIdentity,chain:'robinhood',token:args.token.toLowerCase(),feed:args.feed,captured_at:new Date(args.now??Date.now()).toISOString(),reason,
  price:comparable?positive(s!.price):null,pair_id:comparable?pair:null,price_unit:comparable?'USD':null,
  market_cap:comparable?positive(s!.marketCap):null,liquidity:comparable?positive(s!.liquidity):null,quote_source:s?.source?.slice(0,120)??null};
}
