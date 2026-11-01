/** Combined non-executable Echo shadow admission + localized landing fee.
 * A profitable-looking fee estimate NEVER overrides rejected swap admission.
 * The validator's actual scheduling outcome is unknown; no RPC or broadcast.
 */
import {replayEchoAutoBuyDryRun,type EchoAutoBuyDryRunInput} from './autoBuyDryRunBudget.js';
import {planEchoLandingFee,type EchoLandingFeeInput} from './landingFeeShadow.js';
export function evaluateEchoPriorityDryRun(input:{
 trade:EchoAutoBuyDryRunInput;fee:EchoLandingFeeInput;
}){
 const trade=replayEchoAutoBuyDryRun(input.trade);
 const fees=planEchoLandingFee(input.fee);
 const candidate=trade.verdict.candidate&&fees.ok;
 return {candidate,executable:false as const,signed:false as const,
  broadcast:false as const,guaranteedLanding:false as const,
  reason:!trade.verdict.candidate?trade.verdict.reason:
   'reason' in fees?fees.reason:'SHADOW_CANDIDATE_ONLY',
  trade,fees};
}
