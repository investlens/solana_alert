/**
 * Echo manual-trade lifecycle policy. This module cannot build, sign, or send
 * transactions. A DB reservation is mandatory, but not proof of broadcast.
 * Ambiguous submission outcomes always require chain reconciliation.
 */
export type TradeIntentState =
  | 'RESERVED' | 'QUOTE_VERIFIED' | 'SIMULATED' | 'SUBMISSION_UNKNOWN'
  | 'SUBMITTED' | 'CONFIRMED' | 'FAILED_FINAL' | 'RECONCILIATION_REQUIRED';
export type TradeEvidence = {
  reservationKey:string;
  state:TradeIntentState;
  latestBlockhash?:string;
  lastValidBlockHeight?:number;
  signature?:string;
  transactionFingerprint?:string;
  quoteObservedAtMs?:number;
  simulationObservedAtMs?:number;
};
export type TradeTransition =
  | {kind:'QUOTE_OK';nowMs:number}
  | {kind:'SIMULATION_OK';nowMs:number}
  | {kind:'SUBMISSION_RESULT_UNKNOWN';fingerprint:string;signature?:string}
  | {kind:'SUBMITTED';signature:string;fingerprint:string}
  | {kind:'CHAIN_CONFIRMED';signature:string}
  | {kind:'CHAIN_FAILED_FINAL';signature:string}
  | {kind:'RECONCILIATION_FAILED'};
const sig=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const fingerprint=/^[0-9a-f]{64}$/;
const deny=(reason:string)=>({ok:false as const,reason});
/** Pure transition with no network or side effects. */
export function nextEchoTradeState(previous:TradeEvidence,event:TradeTransition){
  const current=previous.state;
  if(current==='RECONCILIATION_REQUIRED'||current==='SUBMISSION_UNKNOWN')
    return event.kind==='CHAIN_CONFIRMED' && !!previous.signature && event.signature===previous.signature
      ? {ok:true as const,value:{...previous,state:'CONFIRMED' as const}}
      : event.kind==='CHAIN_FAILED_FINAL' && !!previous.signature && event.signature===previous.signature
      ? {ok:true as const,value:{...previous,state:'FAILED_FINAL' as const}}
      : deny('RECONCILE_OR_HALT_NO_RETRY');
  if(current==='CONFIRMED'||current==='FAILED_FINAL')return deny('TERMINAL_INTENT');
  if(event.kind==='QUOTE_OK'){
    if(current!=='RESERVED'||!Number.isSafeInteger(event.nowMs)||event.nowMs<=0)return deny('QUOTE_NOT_ADMISSIBLE');
    return {ok:true as const,value:{...previous,state:'QUOTE_VERIFIED' as const,quoteObservedAtMs:event.nowMs}};
  }
  if(event.kind==='SIMULATION_OK'){
    if(current!=='QUOTE_VERIFIED'||!Number.isSafeInteger(event.nowMs)||
      !Number.isSafeInteger(previous.quoteObservedAtMs)||event.nowMs<previous.quoteObservedAtMs!||
      event.nowMs-previous.quoteObservedAtMs!>3000)return deny('STALE_QUOTE_OR_MISSING_SIMULATION');
    return {ok:true as const,value:{...previous,state:'SIMULATED' as const,simulationObservedAtMs:event.nowMs}};
  }
  if(event.kind==='SUBMITTED'||event.kind==='SUBMISSION_RESULT_UNKNOWN'){
    if(current!=='SIMULATED'||!fingerprint.test(event.fingerprint))return deny('SIMULATION_OR_FINGERPRINT_REQUIRED');
    if(event.kind==='SUBMITTED'&&!sig.test(event.signature))return deny('INVALID_SIGNATURE');
    if(event.kind==='SUBMISSION_RESULT_UNKNOWN'&&event.signature!==undefined&&!sig.test(event.signature))
      return deny('INVALID_SIGNATURE');
    return {ok:true as const,value:{...previous,state:event.kind==='SUBMITTED'?'SUBMITTED' as const:'SUBMISSION_UNKNOWN' as const,
      transactionFingerprint:event.fingerprint,...(event.signature?{signature:event.signature}:{})}};
  }
  if(event.kind==='CHAIN_CONFIRMED'||event.kind==='CHAIN_FAILED_FINAL'){
    if(current!=='SUBMITTED'||previous.signature!==event.signature||!sig.test(event.signature))
      return deny('CHAIN_PROOF_MISMATCH');
    return {ok:true as const,value:{...previous,state:event.kind==='CHAIN_CONFIRMED'?'CONFIRMED' as const:'FAILED_FINAL' as const}};
  }
  if(event.kind==='RECONCILIATION_FAILED'){
    if(current!=='SUBMITTED')return deny('NOT_SUBMITTED');
    return {ok:true as const,value:{...previous,state:'RECONCILIATION_REQUIRED' as const}};
  }
  return deny('UNKNOWN_TRANSITION');
}
/** Neither an admissible transition nor simulation can enable live trading. */
export const ECHO_REAL_BUY_ENABLED=false as const;
export const ECHO_REAL_SELL_ENABLED=false as const;
export const ECHO_AUTO_BUY_ENABLED=false as const;
export const ECHO_AUTO_SELL_ENABLED=false as const;
