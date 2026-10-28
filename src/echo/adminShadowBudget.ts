/**
 * Pure accounting gate for an eventual serializable DB transaction.
 * This function does NOT reserve funds or grant execution permission.
 * A production adapter must lock the execution-wallet budget row, check
 * balances and positions, insert the unique wallet+mint intent, and commit
 * as ONE database transaction before any signing.
 */
export type BudgetSnapshot = Readonly<{
  availableLamports: bigint;
  reservedLamports: bigint;
  minReserveLamports: bigint;
  dailySpentLamports: bigint;
  dailyGrossCapLamports: bigint;
  dailyLossLamports: bigint;
  dailyLossLimitLamports: bigint;
  openPositions: number;
  pendingPositions: number;
  maxOpenPositions: number;
  reconciliationFresh: boolean;
  rpcHealthy: boolean;
  emergencyStop: boolean;
  mintAlreadyPurchased: boolean;
}>;
export type BudgetDecision = Readonly<{ shadowEligible: boolean; reason: string }>;
export function evaluateShadowBudget(s: BudgetSnapshot, stakeLamports: bigint, feeCapLamports: bigint): BudgetDecision {
  const no=(reason:string):BudgetDecision=>({shadowEligible:false,reason});
  if(s.emergencyStop)return no('EMERGENCY_STOP');
  if(!s.reconciliationFresh || !s.rpcHealthy)return no('DEPENDENCIES_UNHEALTHY');
  if(s.mintAlreadyPurchased)return no('ALREADY_PURCHASED');
  if(!Number.isSafeInteger(s.openPositions) || !Number.isSafeInteger(s.pendingPositions) ||
     !Number.isSafeInteger(s.maxOpenPositions) || s.openPositions<0 || s.pendingPositions<0 ||
     s.maxOpenPositions<1 || s.openPositions+s.pendingPositions>=s.maxOpenPositions)return no('POSITION_CAP');
  const numbers=[s.availableLamports,s.reservedLamports,s.minReserveLamports,
    s.dailySpentLamports,s.dailyGrossCapLamports,s.dailyLossLamports,s.dailyLossLimitLamports,
    stakeLamports,feeCapLamports];
  if(numbers.some(n=>n<0n) || stakeLamports===0n || stakeLamports>100_000_000n)return no('INVALID_AMOUNT');
  if(s.dailyLossLamports>=s.dailyLossLimitLamports)return no('DAILY_LOSS_BREAKER');
  if(s.dailySpentLamports+stakeLamports+feeCapLamports>s.dailyGrossCapLamports)return no('DAILY_GROSS_CAP');
  if(s.availableLamports-s.reservedLamports-stakeLamports-feeCapLamports<s.minReserveLamports)return no('INSUFFICIENT_UNRESERVED_BALANCE');
  return {shadowEligible:true,reason:'SHADOW_BUDGET_OK_NOT_EXECUTION_AUTHORIZATION'};
}
