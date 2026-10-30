/** Shared BUY/SELL execution boundary for a future dedicated Echo executor.
 * Requires independent server-side verification: client flags cannot authorize
 * signing; this build intentionally cannot transmit any transaction.
 */
import {screenEchoManualSell,type EchoManualSellRequest} from './manualSellAdmission.js';
import {inspectEchoUnsignedEnvelope,type EchoIsolatedSignerRequest} from './isolatedSignerContract.js';
import {submitEchoSignedTransaction,inspectEchoTransactionConfirmation,
 type EchoChainStatus} from './isolatedTransactionTransport.js';
export type EchoTradeSide='BUY'|'SELL';
export type EchoExecutionEvidence={
 side:EchoTradeSide;wallet:string;mint:string;reservationKey:string;
 unsigned:EchoIsolatedSignerRequest;
 positionReservedInDatabase:boolean;
 signerVerifiedFromIsolatedWorker:boolean;
 onChainSimulationIndependentlyVerified:boolean;
 sell?:EchoManualSellRequest;
};
export type EchoExecutorDecision={allowed:false;reason:string};
export function screenEchoExecutionEvidence(input:EchoExecutionEvidence):EchoExecutorDecision {
 if(!input.positionReservedInDatabase)return {allowed:false,reason:'ATOMIC_RESERVATION_REQUIRED'};
 if(!input.signerVerifiedFromIsolatedWorker||!input.onChainSimulationIndependentlyVerified)
   return {allowed:false,reason:'TRUSTED_EXECUTION_EVIDENCE_REQUIRED'};
 if(input.unsigned.executionWallet!==input.wallet||
    input.unsigned.mint!==input.mint||
    input.unsigned.reservationKey!==input.reservationKey)
   return {allowed:false,reason:'EXECUTION_IDENTITY_MISMATCH'};
 const checked=inspectEchoUnsignedEnvelope(input.unsigned);
 if('reason' in checked)return {allowed:false,reason:checked.reason};
 if(input.side==='SELL'){
   if(!input.sell)return {allowed:false,reason:'MANUAL_SELL_AUTH_REQUIRED'};
   if(input.sell.mint!==input.mint)return {allowed:false,reason:'SELL_MINT_MISMATCH'};
   const approved=screenEchoManualSell(input.sell);
   if('reason' in approved)return {allowed:false,reason:approved.reason};
 }
 // The current signer contract is not able to independently prove the amounts,
 // destination account, route, and fee from a Jupiter/Pump transaction.
 return {allowed:false,reason:'ISOLATED_SIGNER_NOT_READY'};
}
export function manualSellReleasesBuySlot(input:{
 soldPercent:50|100; transactionConfirmed:boolean; balanceZeroVerified:boolean;
 proceedsVerified:boolean; sellSignaturePersisted:boolean;
}):boolean {
 return input.soldPercent===100&&input.transactionConfirmed&&input.balanceZeroVerified&&
    input.proceedsVerified&&input.sellSignaturePersisted;
}
/** Shared RPC mechanism, deliberately not exposed to Telegram routes yet. */
export const echoSharedTradeTransport={
 submitEchoSignedTransaction, inspectEchoTransactionConfirmation
};
export type {EchoChainStatus};
