/**
 * Shadow-only reconciliation decision. Never treats a timeout as a failed
 * transaction: a signed transaction can land after a client timeout.
 * Does not query RPC, release budget, rebroadcast, or send transactions.
 */
export type ChainEvidence = Readonly<{
  intentState: 'reserved'|'signed'|'submitted'|'confirmed'|'failed_preflight'|'unknown'|'expired_unresolved';
  signature: string | null;
  rpcHealthy: boolean;
  historyCaughtUp: boolean;
  blockhashExpired: boolean;
  verifiedFinalizedSuccess: boolean;
  verifiedFinalizedFailure: boolean;
  observedTokenIncrease: boolean;
  authoritativeSignatureStatus: boolean;
}>;
export type ReconcileDecision = Readonly<{
  nextState: ChainEvidence['intentState'];
  releaseReservedFunds: false;
  mayRetryPurchase: false;
  reason: string;
}>;
export function reconcileShadowIntent(e: ChainEvidence): ReconcileDecision {
  const decision=(nextState:ChainEvidence['intentState'],reason:string):ReconcileDecision=>({
    nextState,releaseReservedFunds:false,mayRetryPurchase:false,reason,
  });
  if(e.intentState==='confirmed')return decision('confirmed','ALREADY_CONFIRMED');
  if(e.intentState==='failed_preflight')return decision('failed_preflight','PRE_SIGN_FAILURE');
  if(e.intentState==='expired_unresolved')return decision('expired_unresolved','REQUIRES_MANUAL_REVIEW');
  if(!e.rpcHealthy || !e.historyCaughtUp)return decision('unknown','RPC_OR_HISTORY_UNHEALTHY');
  if(e.verifiedFinalizedSuccess && e.verifiedFinalizedFailure)return decision('unknown','CONFLICTING_CHAIN_EVIDENCE');
  if(e.verifiedFinalizedSuccess && e.authoritativeSignatureStatus && e.observedTokenIncrease)
    return decision('confirmed','FINALIZED_BUY_VERIFIED');
  if(e.verifiedFinalizedFailure && e.authoritativeSignatureStatus)
    return decision('unknown','FINALIZED_FAILURE_REQUIRES_ACCOUNTING_REVIEW');
  if(e.intentState==='reserved' && !e.signature)
    return decision('reserved','AWAITING_SIGNER_OR_CANCELLATION');
  if(e.blockhashExpired)return decision('expired_unresolved','BLOCKHASH_EXPIRED_VERIFY_NON_LANDING');
  return decision('unknown','SUBMISSION_OUTCOME_UNRESOLVED');
}
