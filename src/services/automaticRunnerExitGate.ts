import {cachedArcPoolMetadata} from '../chains/arc/observedPoolCache.js';
import {arcDeliverySafety} from '../chains/arc/promotionPolicy.js';
import {loadArcSecurity} from '../chains/arc/securityProvider.js';
import type {ExitVerification} from './customTokenExitVerification.js';
export function createArcRunnerExitGate(check=loadArcSecurity, assess=arcDeliverySafety){
 return async(row:{chain:string;token:string;pair_id:string}):Promise<ExitVerification>=>{
  if(row.chain!=='arc')return {allowed:false,reason:'Handled by chain owner',observedAt:Date.now()};
  const metadata=await cachedArcPoolMetadata(row.pair_id,row.token).catch(()=>undefined);
  const safety=await assess('ARC_RUNNER',row.token,check,undefined,undefined,row.pair_id,metadata);
  return {allowed:safety.allowed,reason:safety.reason,observedAt:safety.observedAt??Date.now(),pairId:row.pair_id,lpStatus:safety.lpStatus};
 };
}
export const automaticRunnerExitGate=createArcRunnerExitGate();
