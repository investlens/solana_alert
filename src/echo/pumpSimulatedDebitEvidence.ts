/** Review-only PumpSwap fee/debit evidence from an independently verified
 * exact-transaction simulation. Never signs, broadcasts or grants permission.
 *
 * This audit requires *numeric* transaction effects instead of self-reported
 * boolean flags. The simulation provider must authenticate the exact unsigned
 * hash and account state independently before calling this function.
 */
import {createHash} from 'node:crypto';
export const ECHO_SIMULATED_PUMP_DEBIT_SIGNING_ENABLED=false as const;
const LAMPORTS_PER_SOL=1_000_000_000n;
const dec=(raw:string):bigint|null=>typeof raw==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(raw)?BigInt(raw):null;
export type EchoPumpDebitEvidence={
 unsignedBytes:Uint8Array;
 simulatedUnsignedSha256:string;
 simulationSucceeded:boolean;
 simulationSignatureVerificationDisabled:boolean;
 actualWalletBalanceBeforeLamports:string;
 simulatedWalletBalanceAfterLamports:string;
 independentlyObservedNetworkFeeLamports:string;
 reservedAccountRentLamports:string;
 independentlyBoundedAdditionalCpiLamports:string;
 exitReserveLamports:string;
 pendingReservedLamports:string;
 solUsdCents:string;
 /** USD price, account state and fee readings must be fresh to the BUY. */
 observedAtMs:number; nowMs:number;
};
export type EchoPumpDebitAssessment=
 |{ok:true;mode:'SIMULATION_AUDIT_ONLY';signingAllowed:false;
    unsignedSha256:string;observedWalletDebitLamports:string;
    plannedWalletDebitUpperBoundLamports:string;
    allInCents:string;exitReserveRetained:boolean}
 |{ok:false;signingAllowed:false;reason:string};
export function auditEchoPumpSimulatedWalletDebit(x:EchoPumpDebitEvidence):EchoPumpDebitAssessment{
 const fail=(reason:string):EchoPumpDebitAssessment=>({ok:false,signingAllowed:false,reason});
 if(!x.simulationSucceeded||!x.simulationSignatureVerificationDisabled)
   return fail('EXACT_SIMULATION_SUCCESS_REQUIRED');
 if(!Number.isSafeInteger(x.nowMs)||!Number.isSafeInteger(x.observedAtMs)||
    x.observedAtMs>x.nowMs||x.nowMs-x.observedAtMs>3000)
   return fail('STALE_OR_INVALID_SIMULATION_EVIDENCE');
 if(x.unsignedBytes.length<80||x.unsignedBytes.length>3072||
    !/^[0-9a-f]{64}$/.test(x.simulatedUnsignedSha256)||
    createHash('sha256').update(x.unsignedBytes).digest('hex')!==x.simulatedUnsignedSha256)
   return fail('SIMULATED_MESSAGE_HASH_MISMATCH');
 const values=[
  x.actualWalletBalanceBeforeLamports,x.simulatedWalletBalanceAfterLamports,
  x.independentlyObservedNetworkFeeLamports,x.reservedAccountRentLamports,
  x.independentlyBoundedAdditionalCpiLamports,x.exitReserveLamports,
  x.pendingReservedLamports,x.solUsdCents
 ].map(dec);
 if(values.some(v=>v===null))return fail('INVALID_OR_UNBOUNDED_LAMPORTS');
 const [before,after,fee,rent,cpi,exit,pending,price]=values as bigint[];
 if(price<=0n||before<=after||fee<=0n||exit<=0n)
   return fail('INVALID_WALLET_DEBIT_OR_FEE_EVIDENCE');
 const observed=before-after;
 if(observed<fee)return fail('IMPOSSIBLE_WALLET_DEBIT');
 // Upper bound is the measured debit plus explicit independent allowance
 // for CPI/rent that may not be reflected in an incomplete mock/simulation.
 const upper=observed+rent+cpi;
 // The all-in cap is $5; rounding UP to whole cents is conservative.
 const cents=(upper*price+LAMPORTS_PER_SOL-1n)/LAMPORTS_PER_SOL;
 if(cents>500n)return fail('FIVE_DOLLAR_COMPLETE_DEBIT_CAP_EXCEEDED');
 if(before<pending+upper+exit)return fail('WALLET_CANNOT_COVER_DEBIT_AND_EXIT');
 return {ok:true,mode:'SIMULATION_AUDIT_ONLY',signingAllowed:false,
  unsignedSha256:x.simulatedUnsignedSha256,
  observedWalletDebitLamports:String(observed),
  plannedWalletDebitUpperBoundLamports:String(upper),
  allInCents:String(cents),exitReserveRetained:true};
}
