import {getVerifiedRobinhoodLaunchpad} from '../chains/robinhood/trustedLaunchpad.js';
import {verifyCustomTokenExit,type ExitVerification} from './customTokenExitVerification.js';
export function createRunnerExitGate(deps={launch:getVerifiedRobinhoodLaunchpad,exit:verifyCustomTokenExit}){
 return async(row:{chain:string;token:string;pair_id:string}):Promise<ExitVerification>=>{
  if(row.chain==='robinhood'&&await deps.launch(row.token).catch(()=>null))return {allowed:true,reason:'Factory-verified launchpad bypass',observedAt:Date.now()};
  if(row.chain!=='robinhood'&&row.chain!=='arc')return {allowed:false,reason:'Unsupported runner exit verification',observedAt:Date.now()};
  return deps.exit({chain:row.chain,token:row.token,pairId:row.pair_id});
 };
}
export const automaticRunnerExitGate=createRunnerExitGate();
