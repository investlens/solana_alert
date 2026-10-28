/**
 * Read-only Solana RPC adapter. Never broadcasts transactions or reads keys.
 * A caller must independently establish endpoint trust and history coverage.
 */
import { interpretSignatureStatus, type RpcSignatureStatus } from './adminSolanaSignatureEvidence.js';
export type RpcTransport = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type RpcObservation = Readonly<{
  finalizedSuccess: boolean;
  finalizedFailure: boolean;
  authoritative: boolean;
  reason: string;
}>;
export async function observeSolanaSignature(
  transport: RpcTransport, signature: string, trustedRpc: boolean, historyCaughtUp: boolean,
): Promise<RpcObservation> {
  const unknown=(reason:string):RpcObservation=>({
    finalizedSuccess:false,finalizedFailure:false,authoritative:false,reason,
  });
  if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))return unknown('INVALID_SIGNATURE');
  if(!trustedRpc || !historyCaughtUp)return unknown('UNTRUSTED_OR_INCOMPLETE_RPC');
  try{
    const payload=await transport('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);
    if(!payload || typeof payload!=='object')return unknown('INVALID_RPC_RESPONSE');
    const result=(payload as {result?:unknown}).result;
    if(!result || typeof result!=='object')return unknown('INVALID_RPC_RESPONSE');
    const value=(result as {value?:unknown}).value;
    if(!Array.isArray(value) || value.length!==1)return unknown('INVALID_RPC_RESPONSE');
    const status=value[0] as RpcSignatureStatus;
    return interpretSignatureStatus(status,trustedRpc,historyCaughtUp);
  }catch{return unknown('RPC_REQUEST_FAILED');}
}
