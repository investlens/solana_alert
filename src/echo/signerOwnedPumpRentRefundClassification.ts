/** Strict diagnostic classifier for a simulated temporary SPL token-account
 * rent refund. Not a replacement for CPI account ledger, balance proof,
 * token effects, same-bank prestate, or a signer authorization.
 */
export type EchoRentRefundClassification={
 status:'RENT_PATTERN_MATCHED_NOT_AUDITED'|'RENT_PATTERN_NOT_PROVEN';
 reason:string;inferredRentLamports?:string;
 conservativeDebitUpperLamports?:string;
 independentlyAuditedRefund:false;
 payerCpiLedgerReconciled:false;
 signingAllowed:false;broadcastAllowed:false
};
const blocked=(reason:string):EchoRentRefundClassification=>({
 status:'RENT_PATTERN_NOT_PROVEN',reason,
 independentlyAuditedRefund:false,payerCpiLedgerReconciled:false,
 signingAllowed:false,broadcastAllowed:false
});
const decimal=(v:string):bigint|null=>/^(0|[1-9][0-9]{0,17})$/.test(v)?BigInt(v):null;
export function classifyEchoRentRefundPattern(input:{
 ledgerFailureReason:string;
 observedPayerDeltaLamports:string;
 outboundSystemDebitsLamports:string;
 inboundSystemCreditsLamports:string;
 messageNetworkFeeLamports:string;
 liveTokenAccountMinimumRentLamports:string;
 closeToPayerCount:number;topLevelCloseToPayerCount:number;
 exactSameSimulationClosedAccount:boolean;
 closedSourceAbsentAtLaterRpcObservation:boolean;
}):EchoRentRefundClassification{
 const x=[input.observedPayerDeltaLamports,input.outboundSystemDebitsLamports,
  input.inboundSystemCreditsLamports,input.messageNetworkFeeLamports,
  input.liveTokenAccountMinimumRentLamports].map(decimal);
 if(x.some(v=>v===null))return blocked('INVALID_LAMPORT_INPUT');
 const [observed,outbound,inbound,fee,rent]=x as bigint[];
 if(input.ledgerFailureReason!=='UNEXPLAINED_PAYER_LAMPORT_BALANCE_CHANGE'||
    !input.exactSameSimulationClosedAccount||
    input.closeToPayerCount!==1||input.topLevelCloseToPayerCount!==1||
    !input.closedSourceAbsentAtLaterRpcObservation||
    fee<=0n||rent<=0n||observed<=0n||
    outbound<inbound||outbound-inbound<=observed)
  return blocked('INCOMPLETE_ACCOUNT_LIFECYCLE_EVIDENCE');
 // A numerical match is only a plausible fee/rent scenario; it does not
 // prove where every lamport in the closed account came from.
 if((outbound-inbound-observed)+fee!==rent)
  return blocked('REFUND_RENT_AND_FEE_DO_NOT_MATCH');
 // Bound the hypothetical worst debit to every observed outflow + network
 // fee with zero assumed refund. Do not authorize even this bound.
 const upper=outbound+fee;
 if(upper>1_000_000_000n)return blocked('UNBOUNDED_PAYER_COST');
 return {status:'RENT_PATTERN_MATCHED_NOT_AUDITED',
  reason:'TEMPORARY_TOKEN_ACCOUNT_RENT_REFUND_PATTERN_MATCHED_WITHOUT_AMOUNT_PROOF',
  inferredRentLamports:String(rent),
  conservativeDebitUpperLamports:String(upper),
  independentlyAuditedRefund:false,payerCpiLedgerReconciled:false,
  signingAllowed:false,broadcastAllowed:false};
}
