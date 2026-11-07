/** Package 1: signer-owned read-only reconciliation of a bounded wallet debit.
 * A simulation snapshot is NOT a committed balance change, and this module
 * NEVER asserts CPI completeness without separately independently bounded
 * rent / CPI. A payer-only RPC response is explicitly insufficient.
 */
import type {EchoSignerRpcProbeResult} from './signerOwnedPumpRpcProbe.js';
export const ECHO_DEBIT_RECONCILIATION_CAN_SIGN=false as const;
const exact=(x:string):bigint|null=>typeof x==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(x)?BigInt(x):null;
export type EchoDebitEnvelope={
 probe:EchoSignerRpcProbeResult;
 expectedUnsignedSha256:string;
 principalLamports:string;
 independentlyBoundedRentLamports:string|null;
 independentlyBoundedExtraCpiLamports:string|null;
 solUsdCents:string;
 sellReserveLamports:string|null;
 pendingReservedLamports:string|null;
 fullAccountAndCpiProvenanceVerified:boolean;
 sellRouteIndependentlyVerified:boolean;
};
export type EchoDebitEnvelopeResult=
 |{ok:true;mode:'OFFLINE_COST_ENVELOPE_ONLY';upperBuyDebitLamports:string;
   allInCents:string;requiredWalletLamports:string;
   exitReserveLamports:string;pendingCommitmentsLamports:string;
   realExecutionApproved:false;signingAllowed:false;broadcastAllowed:false}
 |{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false};
const fail=(reason:string):EchoDebitEnvelopeResult=>({
 ok:false,reason,signingAllowed:false,broadcastAllowed:false
});
export function reconcileEchoSignerDebitEnvelope(x:EchoDebitEnvelope):EchoDebitEnvelopeResult{
 if(!x.probe.ok||x.probe.unsignedSha256!==x.expectedUnsignedSha256)
  return fail('EXACT_SIGNER_RPC_PROOF_REQUIRED');
 if(!x.fullAccountAndCpiProvenanceVerified||!x.sellRouteIndependentlyVerified)
  return fail('COMPLETE_CPI_AND_EXIT_PROVENANCE_REQUIRED');
 const args=[x.probe.payerBalanceBeforeLamports,
  x.probe.payerBalanceAfterSimulationLamports,x.probe.observedDeltaLamports,
  x.probe.networkFeeEstimateLamports,x.principalLamports,
  x.independentlyBoundedRentLamports,x.independentlyBoundedExtraCpiLamports,
  x.solUsdCents,x.sellReserveLamports,x.pendingReservedLamports];
 if(args.some(v=>v===null))return fail('UNKNOWN_TRANSACTION_COST_COMPONENT');
 const nums=args.map(v=>exact(v as string));
 if(nums.some(v=>v===null))return fail('INVALID_TRANSACTION_COST_COMPONENT');
 const [before,after,delta,fee,principal,rent,cpi,price,sell,pending]=nums as bigint[];
 if(before<=after||before-after!==delta||delta<principal||
    fee===0n||principal===0n||price===0n||sell===0n)
  return fail('INCONSISTENT_OBSERVED_WALLET_DEBIT');
 // Solana simulated account delta may exclude network fees; additionally
 // reserve rent and CPI if an independent provenance verifier cannot show
 // these have ALREADY been accounted for. Double-counting is conservative.
 const upper=delta+fee+rent+cpi;
 const cents=(upper*price+999_999_999n)/1_000_000_000n;
 if(cents>500n)return fail('FIVE_DOLLAR_COMPLETE_DEBIT_EXCEEDED');
 if(before<upper+sell+pending)return fail('INSUFFICIENT_WALLET_AND_EXIT_RESERVES');
 return {ok:true,mode:'OFFLINE_COST_ENVELOPE_ONLY',
  upperBuyDebitLamports:String(upper),allInCents:String(cents),
  requiredWalletLamports:String(upper+sell+pending),
  exitReserveLamports:String(sell),pendingCommitmentsLamports:String(pending),
  realExecutionApproved:false,signingAllowed:false,broadcastAllowed:false};
}
