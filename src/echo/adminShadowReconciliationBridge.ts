/**
 * Read-only bridge between RPC evidence and shadow reconciliation decisions.
 * No database mutations, signing, retries, or broadcasting.
 */
import { observeSolanaSignature, type RpcTransport } from './adminSolanaRpcObserver.js';
import { reconcileShadowIntent, type ChainEvidence, type ReconcileDecision } from './adminShadowReconciliation.js';
export type ReconciliationInput = Readonly<{
  intent: ChainEvidence['intentState'];
  signature: string | null;
  trustedRpc: boolean;
  historyCaughtUp: boolean;
  rpcHealthy: boolean;
  blockhashExpired: boolean;
  observedTokenIncrease: boolean;
}>;
export async function inspectShadowIntent(
  transport: RpcTransport,
  input: ReconciliationInput,
): Promise<ReconcileDecision> {
  const observation=input.signature
    ? await observeSolanaSignature(transport,input.signature,input.trustedRpc,input.historyCaughtUp)
    : {finalizedSuccess:false,finalizedFailure:false,authoritative:false,reason:'NO_SIGNATURE'};
  return reconcileShadowIntent({
    intentState:input.intent,signature:input.signature,rpcHealthy:input.rpcHealthy && input.trustedRpc,
    historyCaughtUp:input.historyCaughtUp,blockhashExpired:input.blockhashExpired,
    verifiedFinalizedSuccess:observation.finalizedSuccess,
    verifiedFinalizedFailure:observation.finalizedFailure,
    authoritativeSignatureStatus:observation.authoritative,
    observedTokenIncrease:input.observedTokenIncrease,
  });
}
