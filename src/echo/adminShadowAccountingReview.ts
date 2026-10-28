/**
 * Pure accounting guard for the Echo shadow pilot.
 * The balance change is evidence only, not an instruction to release reserve.
 * All amounts are lamports represented as bigint to avoid rounding errors.
 */
export type AccountingSnapshot=Readonly<{
  preLamports:bigint;
  postLamports:bigint;
  networkFeeLamports:bigint;
  reservedLamports:bigint;
  maxStakeLamports:bigint;
  rpcTrusted:boolean;
  transactionFinalized:boolean;
  transactionSignatureMatches:boolean;
  walletMatches:boolean;
  freshBalance:boolean;
}>;
export type AccountingReview=Readonly<{
  accepted:boolean;
  observedDebitLamports:bigint;
  purchaseDebitLamports:bigint;
  requiresManualReview:boolean;
  releaseReserveAutomatically:false;
  reason:string;
}>;
export function reviewShadowDebit(s:AccountingSnapshot):AccountingReview{
 const deny=(reason:string):AccountingReview=>({
  accepted:false,observedDebitLamports:0n,purchaseDebitLamports:0n,
  requiresManualReview:true,releaseReserveAutomatically:false,reason,
 });
 if(!s.rpcTrusted||!s.transactionFinalized||!s.transactionSignatureMatches||
    !s.walletMatches||!s.freshBalance)return deny('UNVERIFIED_EVIDENCE');
 if(s.preLamports<0n||s.postLamports<0n||s.networkFeeLamports<0n||
    s.reservedLamports<0n||s.maxStakeLamports<=0n)return deny('INVALID_AMOUNT');
 if(s.postLamports>s.preLamports)return deny('BALANCE_INCREASE_REQUIRES_REVIEW');
 const debit=s.preLamports-s.postLamports;
 if(debit<s.networkFeeLamports)return deny('FEE_EXCEEDS_DEBIT');
 const purchase=debit-s.networkFeeLamports;
 if(purchase>s.maxStakeLamports)return deny('STAKE_CAP_EXCEEDED');
 if(debit>s.reservedLamports)return deny('DEBIT_EXCEEDS_RESERVATION');
 return {accepted:true,observedDebitLamports:debit,purchaseDebitLamports:purchase,
  requiresManualReview:false,releaseReserveAutomatically:false,reason:'SHADOW_DEBIT_VALIDATED'};
}
