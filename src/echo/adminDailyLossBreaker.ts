/**
 * Shadow-only daily loss circuit breaker. Does not submit transactions.
 * Loss is based on independently verified realized P/L, not a price estimate.
 */
export type LossBreakerInput=Readonly<{
  realizedLossLamports:bigint;
  proposedAdditionalLossLamports:bigint;
  dailyLimitLamports:bigint;
  evidenceVerified:boolean;
  dayBoundaryVerified:boolean;
  emergencyStop:boolean;
}>;
export type LossBreakerDecision=Readonly<{allowNewBuy:boolean;reason:string}>;
export function evaluateEchoLossBreaker(input:LossBreakerInput):LossBreakerDecision{
 const deny=(reason:string):LossBreakerDecision=>({allowNewBuy:false,reason});
 if(input.emergencyStop)return deny('EMERGENCY_STOP');
 if(!input.evidenceVerified || !input.dayBoundaryVerified)return deny('UNVERIFIED_LOSS_ACCOUNTING');
 if(input.realizedLossLamports<0n||input.proposedAdditionalLossLamports<0n||
    input.dailyLimitLamports<=0n)return deny('INVALID_LOSS_ACCOUNTING');
 if(input.dailyLimitLamports>150000000n)return deny('LOSS_LIMIT_EXCEEDS_PILOT_CAP');
 if(input.realizedLossLamports>=input.dailyLimitLamports)return deny('DAILY_LOSS_LIMIT_REACHED');
 if(input.realizedLossLamports+input.proposedAdditionalLossLamports>=input.dailyLimitLamports)
  return deny('PROJECTED_LOSS_LIMIT_REACHED');
 return {allowNewBuy:true,reason:'SHADOW_BUDGET_CHECK_PASSED'};
}
