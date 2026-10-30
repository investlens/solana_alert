/** Read-only recovery for uncertain BUY and manual SELL submissions.
 * NEVER broadcasts or automatically retries. A missing signature holds the
 * slot until an operator reconciles the original transaction.
 */
import type { EchoTradeStateJournal } from './tradeStateJournal.js';
import {inspectEchoTransactionConfirmation} from './isolatedTransactionTransport.js';
export type EchoReconcileOutcome=
 | {kind:'NOT_APPLICABLE'|'HOLD'|'CONFIRMED'|'FAILED_FINAL';reason:string};
export async function reconcileEchoTradeFromChain(
 journal:EchoTradeStateJournal,key:string,rpcUrl:string,
 fetcher:typeof fetch=fetch
):Promise<EchoReconcileOutcome>{
 const record=journal.get(key);
 if(!record)return {kind:'NOT_APPLICABLE',reason:'NO_RECORD'};
 if(!['SUBMITTED','SUBMISSION_UNKNOWN','RECONCILIATION_REQUIRED'].includes(record.state))
  return {kind:'NOT_APPLICABLE',reason:'NO_CHAIN_SUBMISSION_TO_RECONCILE'};
 if(!record.signature)return {kind:'HOLD',reason:'UNKNOWN_SIGNATURE_NO_RETRY'};
 const status=await inspectEchoTransactionConfirmation({rpcUrl,signature:record.signature},fetcher);
 if(status.kind==='UNKNOWN'||status.kind==='PENDING')
  return {kind:'HOLD',reason:'NOT_FINAL_NO_RETRY'};
 const event={kind:status.kind==='CONFIRMED'?'CHAIN_CONFIRMED' as const:'CHAIN_FAILED_FINAL' as const,
  signature:record.signature};
 const applied=await journal.advance(key,event);
 if(!applied.ok)return {kind:'HOLD',reason:'JOURNAL_RECONCILIATION_FAILED'};
 return status.kind==='CONFIRMED'
  ? {kind:'CONFIRMED',reason:'CHAIN_SIGNATURE_VERIFIED'}
  : {kind:'FAILED_FINAL',reason:'CHAIN_FAILURE_VERIFIED'};
}
