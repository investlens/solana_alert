import {verifyCustomTokenExit,type ExitRequest,type ExitVerification} from '../../services/customTokenExitVerification.js';
export const ARC_PROMOTION_WARNING = 'Custom alerts require a verified simulated exit. LP lock: unable to verify; execution can change.';
export function isArcPromotionFeed(feed: string): boolean {
  return feed === 'ARC_BOOST' || feed === 'ARC_DEX_PAID';
}
import type {ArcBoostSafety} from './boostSafety.js';
export async function arcDeliverySafety(feed:string,token:string,check:(token:string)=>Promise<ArcBoostSafety & {observedAt?:number}>,verifyExit:(request:ExitRequest)=>Promise<ExitVerification>=verifyCustomTokenExit):Promise<ArcBoostSafety & {observedAt?:number}> {
  {
    const safety = await check(token).catch(() => ({allowed:false,reason:'Provider check unavailable'} as ArcBoostSafety));
    if (safety.sellabilityBlocked || (feed==='ARC_OPPORTUNITY'&&!safety.allowed)) return safety;
    const exit=await verifyExit({chain:'arc',token});
    const warning=exit.lpStatus==='LOCKED'||exit.lpStatus==='BURNED'?'':exit.lpStatus==='UNLOCKED'?'RISKY ALERT — LIQUIDITY NOT LOCKED. Liquidity can be withdrawn; you may lose your investment. Trade at your own risk.':'RISKY ALERT — LP LOCK STATUS UNAVAILABLE. Liquidity protection is unverified. Trade at your own risk.';
    return {...safety,allowed:exit.allowed,sellabilityVerified:exit.allowed,reason:exit.reason+(exit.allowed&&warning?' · '+warning:''),lpStatus:exit.lpStatus};
  }
}
