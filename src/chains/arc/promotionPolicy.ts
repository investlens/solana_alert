import {verifyCustomTokenExit,type ExitRequest,type ExitVerification} from '../../services/customTokenExitVerification.js';
export const ARC_PROMOTION_WARNING = 'ARC alerts require verified exit evidence: simulation or recent receipt-backed sells. Liquidity protection may be unverified; execution can change.';
export function isArcPromotionFeed(feed: string): boolean {
  return feed === 'ARC_BOOST' || feed === 'ARC_DEX_PAID';
}
import {verifyArcObservedSelling,type ArcObservedSelling,type ArcObservedPoolMetadata} from './observedSelling.js';
import type {ArcBoostSafety} from './boostSafety.js';
export function arcLiquidityDisclosure(status:ArcBoostSafety['lpStatus']):string {
  return status==='LOCKED'||status==='BURNED'?'Liquidity protection verified · '+status+'. Trading and contract risks remain.':status==='UNLOCKED'?'RISKY ALERT — LIQUIDITY NOT LOCKED. The owner may withdraw liquidity; you may lose your investment.':'RISKY ALERT — LIQUIDITY PROTECTION UNVERIFIED. Lock/burn status could not be verified; liquidity may be withdrawn.';
}
export async function arcDeliverySafety(feed:string,token:string,check:(token:string)=>Promise<ArcBoostSafety & {observedAt?:number}>,verifyExit:(request:ExitRequest)=>Promise<ExitVerification>=verifyCustomTokenExit,observe:(token:string,creator?:string|null,expectedPool?:string,metadata?:ArcObservedPoolMetadata)=>Promise<ArcObservedSelling>=verifyArcObservedSelling,expectedPool?:string,metadata?:ArcObservedPoolMetadata):Promise<ArcBoostSafety & {observedAt?:number}> {
  const safety=await check(token).catch(()=>({allowed:false,reason:'Provider check unavailable'} as ArcBoostSafety));
  if(safety.sellabilityBlocked || (!safety.allowed&&!safety.receiptFallbackEligible))return safety;
  // The deployed ARC simulator has no supported native-quote funding. Do not spend RPC calls probing it per candidate.
  // An injected verifier remains available for independent simulator validation and tests.
  const exit=verifyExit===verifyCustomTokenExit?{allowed:false,reason:'Exit unverified: ARC simulation unavailable',observedAt:Date.now()} as ExitVerification:await verifyExit({chain:'arc',token,pairId:expectedPool});
  if(exit.allowed)return {...safety,allowed:true,sellabilityVerified:true,sellabilityMethod:'SIMULATED_EXIT',reason:exit.reason+' · '+arcLiquidityDisclosure(exit.lpStatus),lpStatus:exit.lpStatus};
  if(/revert|confirmed|failed|restriction/i.test(exit.reason))return {...safety,allowed:false,sellabilityVerified:false,reason:exit.reason};
  const observed=await observe(token,safety.creator,expectedPool,metadata);
  if(!observed.allowed)return {...safety,allowed:false,sellabilityVerified:false,reason:exit.reason+' · '+observed.reason};
  // ERC20 LP-holder claims do not establish protection of a V4 pool's NFT positions.
  // Until exact-pool position protection is independently verified, disclose UNKNOWN.
  return {...safety,allowed:true,sellabilityVerified:false,sellabilityMethod:'OBSERVED_SELLS',observedSelling:observed,lpStatus:'UNKNOWN',observedAt:observed.observedAt,reason:observed.reason+(safety.receiptFallbackEligible?' · Full-sell provider flag unavailable; observed sells do not prove a full exit.':'')+' · '+arcLiquidityDisclosure('UNKNOWN')};
}
