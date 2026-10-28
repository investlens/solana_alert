/**
 * Pure parser for verified Solana JSON-RPC getSignatureStatuses responses.
 * RPC results are hints until paired with trusted RPC identity, transaction
 * metadata and token balance evidence. No transaction is signed or broadcast.
 */
export type RpcSignatureStatus = Readonly<{
  confirmationStatus?: 'processed'|'confirmed'|'finalized'|null;
  err?: unknown;
  slot?: number;
}> | null;
export type SignatureObservation = Readonly<{
  finalizedSuccess: boolean;
  finalizedFailure: boolean;
  authoritative: boolean;
  reason: string;
}>;
export function interpretSignatureStatus(
  status: RpcSignatureStatus,
  trustedRpc: boolean,
  historyCaughtUp: boolean,
): SignatureObservation {
  const unknown=(reason:string):SignatureObservation=>({
    finalizedSuccess:false,finalizedFailure:false,authoritative:false,reason,
  });
  if(!trustedRpc || !historyCaughtUp)return unknown('UNTRUSTED_OR_INCOMPLETE_RPC');
  if(!status || status.confirmationStatus!=='finalized' ||
     !Number.isSafeInteger(status.slot) || (status.slot??0)<0)
    return unknown('NOT_FINALIZED');
  if(status.err === undefined)return unknown('MISSING_ERROR_FIELD');
  if(status.err === null)return {
    finalizedSuccess:true,finalizedFailure:false,authoritative:true,reason:'FINALIZED_SUCCESS',
  };
  return {finalizedSuccess:false,finalizedFailure:true,authoritative:true,reason:'FINALIZED_FAILURE'};
}
