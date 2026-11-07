/** Diagnostic budget check using all known outgoing lamports plus network fee.
 * A possible rent refund is NEVER subtracted from this worst-case ceiling.
 * This does not establish exact CPI costs, independently fresh FX or approve
 * signing. A live signer must separately enforce a verified budget gate.
 */
export type EchoPilotNoRefundBudget={
 status:'CONSERVATIVE_UPPER_WITHIN_SCENARIO_CAP'|'EXCEEDS_SCENARIO_CAP'|'UNVERIFIED';
 reason:string;scenarioCapCents:250|500;
 conservativeUpperLamports?:string;upperCostCeilingCents?:string;
 fxIsSignedOracle:false;allProgramDebitsProven:false;
 signingAllowed:false;broadcastAllowed:false
};
const fail=(reason:string,cap:250|500):EchoPilotNoRefundBudget=>({
 status:'UNVERIFIED',reason,scenarioCapCents:cap,fxIsSignedOracle:false,
 allProgramDebitsProven:false,signingAllowed:false,broadcastAllowed:false
});
export function evaluateEchoPilotNoRefundBudget(input:{
 scenarioCapCents:250|500;
 solUsdUpperCents:string;
 reconstructedOutboundLamports:string;
 independentlyQuotedNetworkFeeLamports:string;
}):EchoPilotNoRefundBudget{
 const cap=input.scenarioCapCents;
 if(cap!==250&&cap!==500)return fail('UNSUPPORTED_PILOT_CAP',250);
 const decimal=/^[1-9][0-9]{0,17}$/;
 if(!decimal.test(input.solUsdUpperCents)||
    !decimal.test(input.reconstructedOutboundLamports)||
    !decimal.test(input.independentlyQuotedNetworkFeeLamports))
  return fail('UNTRUSTED_CAP_OR_PRICE_INPUT',cap);
 const price=BigInt(input.solUsdUpperCents);
 const outbound=BigInt(input.reconstructedOutboundLamports);
 const fee=BigInt(input.independentlyQuotedNetworkFeeLamports);
 if(price<100n||price>10000000n||outbound>1_000_000_000n||
    fee>1_000_000n)
  return fail('UNBOUNDED_ECONOMIC_INPUT',cap);
 const upper=outbound+fee;
 const cents=(upper*price+999_999_999n)/1_000_000_000n;
 return {
  status:cents>BigInt(cap)?'EXCEEDS_SCENARIO_CAP':
   'CONSERVATIVE_UPPER_WITHIN_SCENARIO_CAP',
  reason:cents>BigInt(cap)?'FAIL_CLOSED_NO_REFUND_CEILING_EXCEEDS_CAP':
   'DIAGNOSTIC_ONLY_NOT_VERIFIED_PROGRAM_OR_EXIT_COSTS',
  scenarioCapCents:cap,conservativeUpperLamports:String(upper),
  upperCostCeilingCents:String(cents),
  fxIsSignedOracle:false,allProgramDebitsProven:false,
  signingAllowed:false,broadcastAllowed:false
 };
}
