/** Echo owner-only USD pilot capital gate, for independent preflight checks.
 * Pure, fail-closed and READ_ONLY. Never grants signing or broadcast authority.
 * Amounts are exact integer cents; fees must include ALL expected BUY expenses
 * (priority, signature, venue, builder, rent/ATA and worst-case slippage).
 * A reservation transaction must still enforce these caps atomically.
 */
export const ECHO_PILOT_CAP_USD_CENTS = 3000n;
export const ECHO_PILOT_ENTRY_CAP_USD_CENTS = 1000n;
export const ECHO_PILOT_MAX_OPEN_OR_PENDING = 2;
export const ECHO_PILOT_BUDGET_ALLOWS_EXECUTION = false as const;
type DecimalCents = string;
export type EchoPilotBudgetInput = {
  /** Actual SOL wallet balance valued at a verified conservative SOL/USD reference. */
  spendableWalletCents: DecimalCents;
  /** Reserved capital including pending and UNKNOWN broadcast outcomes. */
  reservedAndOpenCents: DecimalCents;
  /** Total already committed for this pilot, including past losses and costs. */
  cumulativeCommittedCents: DecimalCents;
  /** Estimated max principal in this new order (not merely a target stake). */
  newPrincipalCents: DecimalCents;
  /** Independent worst-case estimate of ALL incremental buy costs. */
  allInBuyCostsCents: DecimalCents | null;
  /** Buffer to preserve for network actions including manual SELL. */
  exitAndNetworkReserveCents: DecimalCents;
  openOrPendingPositions: number;
  killSwitch: boolean;
  verifiedFreshSolUsd: boolean;
  verifiedBuyAndSellRoutes: boolean;
  durableReservationReady: boolean;
};
export type EchoPilotBudgetResult =
  | {eligible:true; executable:false; reason:'BUDGET_PREFLIGHT_ONLY'; projectedCommittedCents:string; newAllInCents:string}
  | {eligible:false; executable:false; reason:string};
const parse=(s:DecimalCents|null):bigint|null =>
  typeof s==='string' && /^(0|[1-9][0-9]{0,15})$/.test(s) ? BigInt(s) : null;
export function screenEchoPilotTotalBudget(x:EchoPilotBudgetInput):EchoPilotBudgetResult {
 const fail=(reason:string):EchoPilotBudgetResult=>({eligible:false,executable:false,reason});
 if(x.killSwitch)return fail('KILL_SWITCH');
 if(!x.verifiedFreshSolUsd)return fail('SOL_USD_PRICE_UNVERIFIED');
 if(!x.verifiedBuyAndSellRoutes)return fail('BUY_OR_MANUAL_SELL_ROUTE_UNVERIFIED');
 if(!x.durableReservationReady)return fail('ATOMIC_RESERVATION_NOT_READY');
 if(!Number.isSafeInteger(x.openOrPendingPositions)||x.openOrPendingPositions<0||
    x.openOrPendingPositions>=ECHO_PILOT_MAX_OPEN_OR_PENDING)return fail('POSITION_LIMIT');
 const raw=[x.spendableWalletCents,x.reservedAndOpenCents,x.cumulativeCommittedCents,
   x.newPrincipalCents,x.allInBuyCostsCents,x.exitAndNetworkReserveCents].map(parse);
 if(raw.some(v=>v===null))return fail('MISSING_OR_INVALID_ALL_IN_COSTS');
 const [balance,reserved,committed,principal,costs,reserve]=raw as bigint[];
 if(principal<=0n||principal>ECHO_PILOT_ENTRY_CAP_USD_CENTS)return fail('ENTRY_CAP_EXCEEDED');
 if(costs<=0n||reserve<=0n)return fail('FEES_OR_SELL_RESERVE_UNVERIFIED');
 const newAllIn=principal+costs;
 if(newAllIn>ECHO_PILOT_ENTRY_CAP_USD_CENTS)return fail('ALL_IN_ENTRY_EXCEEDS_TEN_DOLLARS');
 if(committed+newAllIn>ECHO_PILOT_CAP_USD_CENTS)return fail('PILOT_THIRTY_DOLLAR_CAP');
 // Reserved orders/unknown sends stay locked, and the wallet must retain
 // enough spendable value for this order plus future manual-exit fees.
 if(balance<reserved+newAllIn+reserve)return fail('INSUFFICIENT_AVAILABLE_BALANCE_AND_EXIT_RESERVE');
 // Committed amounts are independently tracked by the ledger; the guard cannot
 // infer double-counting from a single snapshot. Coordinator must reconcile.
 return {eligible:true,executable:false,reason:'BUDGET_PREFLIGHT_ONLY',
   projectedCommittedCents:String(committed+newAllIn),newAllInCents:String(newAllIn)};
}
