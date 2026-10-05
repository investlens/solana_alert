export const ARC_PROMOTION_WARNING = 'Liquidity, honeypot and sellability NOT CHECKED. Verify selling and liquidity yourself before investing.';
export function isArcPromotionFeed(feed: string): boolean {
  return feed === 'ARC_BOOST' || feed === 'ARC_DEX_PAID';
}
import type {ArcBoostSafety} from './boostSafety.js';
export async function arcDeliverySafety(feed:string,token:string,check:(token:string)=>Promise<ArcBoostSafety & {observedAt?:number}>):Promise<ArcBoostSafety & {observedAt?:number}> {
  if (isArcPromotionFeed(feed)) return {allowed:true,reason:ARC_PROMOTION_WARNING,sellabilityVerified:false};
  return check(token);
}
