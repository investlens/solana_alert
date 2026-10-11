import {getVerifiedRobinhoodLaunchpad} from '../chains/robinhood/trustedLaunchpad.js';
import {routeBoostSecurity} from '../chains/robinhood/boostSecurityRouter.js';
// All Robinchain positive alerts resolve authoritative origin before any
// custom checks. Snapshot availability is deliberately not an input.
export function createRobinhoodAlertSafety(deps={launch:getVerifiedRobinhoodLaunchpad,gate:routeBoostSecurity}) {
  return async(token:string)=>{
    const origin=await deps.launch(token).catch(()=>null);
    const security=await deps.gate({tokenAddress:token,verifiedTrustedLaunchpad:origin!==null});
    return {origin,security};
  };
}
export const robinhoodAlertSafety=createRobinhoodAlertSafety();
