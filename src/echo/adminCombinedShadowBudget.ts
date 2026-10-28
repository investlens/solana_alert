/**
 * Single pure shadow eligibility gate combining wallet accounting and daily
 * realized loss. Never authorizes signing or execution.
 */
import { evaluateEchoLossBreaker, type LossBreakerInput } from './adminDailyLossBreaker.js';
export type CombinedPilotBudget=Readonly<{
  loss:LossBreakerInput;
  walletBalanceLamports:bigint;
  reservedLamports:bigint;
  minReserveLamports:bigint;
  buyLamports:bigint;
  feeCapLamports:bigint;
  dailySpentLamports:bigint;
  dailyGrossCapLamports:bigint;
  openPositions:number;
  pendingPositions:number;
  walletFresh:boolean;
  rpcHealthy:boolean;
  reconciliationFresh:boolean;
}>;
export function evaluateCombinedShadowBudget(b:CombinedPilotBudget):Readonly<{
 eligible:boolean;reason:string;liveExecutionAllowed:false
}>{
 const deny=(reason:string)=>({eligible:false,reason,liveExecutionAllowed:false as const});
 const loss=evaluateEchoLossBreaker(b.loss);
 if(!loss.allowNewBuy)return deny(loss.reason);
 if(!b.walletFresh||!b.rpcHealthy||!b.reconciliationFresh)return deny('STALE_WALLET_OR_RPC');
 if(b.walletBalanceLamports<0n||b.reservedLamports<0n||b.minReserveLamports<0n||
    b.dailySpentLamports<0n||b.dailyGrossCapLamports<=0n||
    b.buyLamports<=0n||b.buyLamports>100000000n||
    b.feeCapLamports<0n||b.feeCapLamports>10000000n)return deny('INVALID_BUDGET');
 if(!Number.isSafeInteger(b.openPositions)||!Number.isSafeInteger(b.pendingPositions)||
    b.openPositions<0||b.pendingPositions<0||b.openPositions+b.pendingPositions>=2)
    return deny('POSITION_LIMIT');
 const needed=b.buyLamports+b.feeCapLamports;
 if(b.walletBalanceLamports-b.reservedLamports-needed<b.minReserveLamports)
    return deny('INSUFFICIENT_AVAILABLE_BALANCE');
 if(b.dailySpentLamports+needed>b.dailyGrossCapLamports)return deny('DAILY_GROSS_CAP');
 return {eligible:true,reason:'SHADOW_ELIGIBLE_ONLY',liveExecutionAllowed:false};
}
