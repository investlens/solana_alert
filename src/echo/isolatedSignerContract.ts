/** Execution boundary used by a FUTURE isolated signer service.
 * This contract alone is not a signer or approval to broadcast.
 * Never include wallet secrets in request/response payloads.
 */
import { verifyEchoExecutionWallet } from './executionWallet.js';
export type EchoIsolatedSignerRequest={
 executionWallet:string; mint:string; reservationKey:string;
 unsignedTransactionBase64:string; simulationVerified:boolean;
 destinationAndProgramsVerified:boolean; freshQuoteVerified:boolean;
};
export type EchoSignerApproval={ok:true;wallet:string}|{ok:false;reason:string};
export function reviewEchoSignerRequest(request:EchoIsolatedSignerRequest):EchoSignerApproval {
 if(!verifyEchoExecutionWallet(request.executionWallet))return {ok:false,reason:'WALLET_MISMATCH'};
 if(request.reservationKey!==request.executionWallet+':'+request.mint)
  return {ok:false,reason:'UNMATCHED_RESERVATION'};
 if(!request.simulationVerified||!request.destinationAndProgramsVerified||!request.freshQuoteVerified)
  return {ok:false,reason:'UNVERIFIED_TRANSACTION'};
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(request.mint)||
   !/^[A-Za-z0-9+/]+={0,2}$/.test(request.unsignedTransactionBase64)||
   request.unsignedTransactionBase64.length<100||
   request.unsignedTransactionBase64.length>4096)
  return {ok:false,reason:'INVALID_UNSIGNED_TRANSACTION'};
 return {ok:true,wallet:request.executionWallet};
}
/** Block all signing and broadcasting until validated isolated executor is integrated. */
export const ECHO_SIGNER_ENABLED=false as const;
