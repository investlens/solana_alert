/** A precise outcome for the repeatable SPL native-account closure refund.
 * The strict CPI ledger deliberately excludes non-System lamport credits.
 * A match with token rent must NEVER be mislabelled as a fully reconciled
 * payer ledger or used to authorize execution.
 */
export type EchoRefundAwarePayerReview={
 status:'RENT_REFUND_ACCOUNTING_GAP'|'UNEXPLAINED_PAYER_EFFECT';
 reason:'PAYER_TOKEN_RENT_REFUND_UNATTESTED'|'PAYER_EFFECT_STILL_UNEXPLAINED';
 observedDebitLamports:string;
 systemOutflowsPlusNetworkFeeLamports:string;
 expectedRentRefundLamports?:string;
 differenceFromExactRentLamports?:string;
 signerEconomicAuthorization:false;
 completePayerLedgerReconciled:false;
 fullTokenDeliveryVerified:false;
 signingAllowed:false;broadcastAllowed:false
};
const decimal=(v:string)=>/^(0|[1-9][0-9]{0,17})$/.test(v)?BigInt(v):null;
export function reviewEchoRefundAwarePayer(input:{
 observedDebitLamports:string;
 outboundSystemDebitsLamports:string;
 inboundSystemCreditsLamports:string;
 independentlyEstimatedNetworkFeeLamports:string;
 independentlyQueriedTokenRentLamports:string;
 independentRentRpcMatched:boolean;
 exactlyOneTopLevelCloseToPayer:boolean;
 sameSimulationCloseStateObserved:boolean;
}):EchoRefundAwarePayerReview{
 const parse=[
  input.observedDebitLamports,input.outboundSystemDebitsLamports,
  input.inboundSystemCreditsLamports,
  input.independentlyEstimatedNetworkFeeLamports,
  input.independentlyQueriedTokenRentLamports
 ].map(decimal);
 const [observed,outbound,credits,fee,rent]=parse;
 // Values are diagnostic-only and cannot be used for a privileged signer.
 // Unlike the legacy ledger, report rent-adjusted mismatch independently.
 const upper=outbound!==null&&fee!==null?outbound+fee:null;
 const gap=upper!==null&&credits!==null&&observed!==null?
  upper-credits-observed:null;
 const matched=!!(input.independentRentRpcMatched&&
  input.exactlyOneTopLevelCloseToPayer&&
  input.sameSimulationCloseStateObserved&&
  observed!==null&&observed>0n&&
  outbound!==null&&outbound>0n&&outbound<=1_000_000_000n&&
  credits===0n&&fee!==null&&fee>0n&&fee<1_000_000n&&
  rent!==null&&rent>0n&&
  gap!==null&&gap===rent);
 return {
  status:matched?'RENT_REFUND_ACCOUNTING_GAP':'UNEXPLAINED_PAYER_EFFECT',
  reason:matched?'PAYER_TOKEN_RENT_REFUND_UNATTESTED':
   'PAYER_EFFECT_STILL_UNEXPLAINED',
  observedDebitLamports:observed===null?'INVALID':String(observed),
  systemOutflowsPlusNetworkFeeLamports:upper===null?'INVALID':String(upper),
  ...(matched?{expectedRentRefundLamports:String(rent),
   differenceFromExactRentLamports:'0'}:{}),
  signerEconomicAuthorization:false,
  completePayerLedgerReconciled:false,
  fullTokenDeliveryVerified:false,
  signingAllowed:false,broadcastAllowed:false
 };
}
