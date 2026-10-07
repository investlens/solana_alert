export const ARC_PROMOTION_WARNING = 'Liquidity, honeypot and sellability NOT CHECKED. Verify selling and liquidity yourself before investing.';
export function isArcPromotionFeed(feed: string): boolean {
  return feed === 'ARC_BOOST' || feed === 'ARC_DEX_PAID';
}
import type {ArcBoostSafety} from './boostSafety.js';
export async function arcDeliverySafety(feed:string,token:string,check:(token:string)=>Promise<ArcBoostSafety & {observedAt?:number}>):Promise<ArcBoostSafety & {observedAt?:number}> {
  if (isArcPromotionFeed(feed)) {
    const safety = await check(token).catch(() => ({allowed:false,reason:'Provider check unavailable'} as ArcBoostSafety));
    if (safety.sellabilityBlocked) return safety;
    return {...safety,allowed:true,reason:safety.sellabilityVerified
      ? 'No honeypot/sell-restriction flag reported. LP lock unverified; validate liquidity before buying.'
      : 'Sellability and LP lock unverified. Validate liquidity and selling before buying.'};
  }
  return check(token);
}
