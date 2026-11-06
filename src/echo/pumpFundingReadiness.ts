/** Diagnostic funding envelope for a real PumpSwap unsigned BUY.
 * Pure arithmetic. No RPC, signing, broadcast or wallet funding.
 *
 * IMPORTANT: The floor is what the WALLET must hold to attempt the currently
 * priced unsigned transaction, not a guaranteed successful simulation or
 * permission to transfer SOL. CPI and manual-SELL reserve MUST be independently
 * bounded before a launch-specific funding requirement can be reported.
 */
const parse=(s:string):bigint|null=>typeof s==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(s)?BigInt(s):null;
export const ECHO_FUNDING_READINESS_AUTHORISES_FUNDING=false as const;
export type PumpFundingEvidence={
 principalLamports:string;networkFeeLamports:string;
 absentAtaCount:number;maxAtaRentPerAccountLamports:string;
 walletBalanceLamports:string;
 /** Null means UNKNOWN, never substitute 0 for an unknown debit. */
 extraCpiDebitUpperBoundLamports:string|null;
 manualSellExitReserveLamports:string|null;
 pendingReservedDebitsLamports:string|null;
 /** A fully verified $5 order requires a fresh price supplied externally. */
 solUsdCents:string|null;
 fullPumpCpiAndRentAudited:boolean;manualSellSimulationVerified:boolean;
};
export type PumpFundingAssessment={
 mode:'UNSIGNED_DIAGNOSTIC_ONLY';canFund:false;canSign:false;canBroadcast:false;
 provisionalUnsignedAttemptFloorLamports:string|null;
 provisionalShortfallLamports:string|null;
 fullyVerifiedFundingRequirementLamports:string|null;
 maxFiveDollarBuyDebitLamports:string|null;
 reason:string;
};
export function assessPumpFundingReadiness(e:PumpFundingEvidence):PumpFundingAssessment{
 const deny=(reason:string,floor:bigint|null=null,shortfall:bigint|null=null,
  cap:bigint|null=null):PumpFundingAssessment=>({
  mode:'UNSIGNED_DIAGNOSTIC_ONLY',canFund:false,canSign:false,canBroadcast:false,
  provisionalUnsignedAttemptFloorLamports:floor===null?null:String(floor),
  provisionalShortfallLamports:shortfall===null?null:String(shortfall),
  fullyVerifiedFundingRequirementLamports:null,
  maxFiveDollarBuyDebitLamports:cap===null?null:String(cap),
  reason});
 const p=parse(e.principalLamports),f=parse(e.networkFeeLamports),
  rent=parse(e.maxAtaRentPerAccountLamports),balance=parse(e.walletBalanceLamports);
 if([p,f,rent,balance].some(v=>v===null)||
  p===0n||f===0n||!Number.isSafeInteger(e.absentAtaCount)||
  e.absentAtaCount<0||e.absentAtaCount>10)
  return deny('INVALID_PROVISIONAL_FEE_OR_BALANCE_EVIDENCE');
 const floor=p!+f!+BigInt(e.absentAtaCount)*rent!;
 const shortage=floor>balance!?floor-balance!:0n;
 if(!e.fullPumpCpiAndRentAudited||!e.manualSellSimulationVerified)
  return deny('CPI_AND_MANUAL_SELL_RESERVE_NOT_FULLY_VERIFIED',floor,shortage);
 const cpi=e.extraCpiDebitUpperBoundLamports===null?null:parse(e.extraCpiDebitUpperBoundLamports);
 const sell=e.manualSellExitReserveLamports===null?null:parse(e.manualSellExitReserveLamports);
 const pending=e.pendingReservedDebitsLamports===null?null:parse(e.pendingReservedDebitsLamports);
 const usd=e.solUsdCents===null?null:parse(e.solUsdCents);
 if(cpi===null||sell===null||pending===null||usd===null||
    sell===0n||usd===0n)
  return deny('UNKNOWN_EXTRA_CPI_SELL_RESERVE_PENDING_OR_FX',floor,shortage);
 const maxFive=(500n*1_000_000_000n)/usd;
 const allIn=floor+cpi;
 if(allIn>maxFive)return deny('ALL_IN_ENTRY_WOULD_EXCEED_FIVE_DOLLARS',floor,shortage,maxFive);
 // Even with known costs, this function is diagnostic-only: never labels
 // an amount safe to transfer or authorizes the isolated real signer.
 return {
  mode:'UNSIGNED_DIAGNOSTIC_ONLY',canFund:false,canSign:false,canBroadcast:false,
  provisionalUnsignedAttemptFloorLamports:String(floor),
  provisionalShortfallLamports:String(shortage),
  fullyVerifiedFundingRequirementLamports:String(allIn+sell+pending),
  maxFiveDollarBuyDebitLamports:String(maxFive),
  reason:'FUNDED_STATE_SIMULATION_AND_OWNER_APPROVAL_STILL_REQUIRED'
 };
}
