/**
 * Future signer boundary. No key material, RPC, transaction construction, or signing.
 * Signer implementation MUST live in a separate service and independently revalidate
 * serialized instructions and amounts. Telegram is never a signing authority.
 */
export type SignerRequest = Readonly<{
  requestId: string;
  authenticatedService: boolean;
  adminApprovedDeployment: boolean;
  wallet: string;
  intentWallet: string;
  intentMint: string;
  intentState: string;
  transactionMint: string;
  transactionWallet: string;
  amountLamports: number;
  maxAmountLamports: number;
  feeLamports: number;
  maxFeeLamports: number;
  allowedProgramIds: readonly string[];
  transactionProgramIds: readonly string[];
  transactionHashMatchesApprovedQuote: boolean;
  simulationPassed: boolean;
  emergencyStop: boolean;
}>;
export type SignerDecision = Readonly<{ allowed: false; reason: string }>;
/**
 * Intentionally never grants signing: this repository has not been approved
 * for real-money execution. All policy decisions are denials.
 */
export function evaluateSignerBoundary(r: SignerRequest): SignerDecision {
  const deny = (reason: string): SignerDecision => ({ allowed: false, reason });
  if (!r.authenticatedService) return deny('UNAUTHENTICATED_EXECUTOR');
  if (!r.adminApprovedDeployment) return deny('DEPLOYMENT_NOT_APPROVED');
  if (r.emergencyStop) return deny('EMERGENCY_STOP');
  if (!r.requestId || r.wallet !== r.intentWallet || r.wallet !== r.transactionWallet ||
      r.intentMint !== r.transactionMint || r.intentState !== 'reserved') return deny('INTENT_MISMATCH');
  if (!Number.isSafeInteger(r.amountLamports) || r.amountLamports <= 0 ||
      r.amountLamports > 100_000_000 || r.amountLamports > r.maxAmountLamports) return deny('AMOUNT_LIMIT');
  if (!Number.isSafeInteger(r.feeLamports) || r.feeLamports < 0 ||
      !Number.isSafeInteger(r.maxFeeLamports) || r.maxFeeLamports < 0 ||
      r.feeLamports > r.maxFeeLamports) return deny('FEE_LIMIT');
  if (!r.transactionHashMatchesApprovedQuote || !r.simulationPassed) return deny('TRANSACTION_NOT_VERIFIED');
  if (!r.transactionProgramIds.length || !r.allowedProgramIds.length ||
      r.transactionProgramIds.some(id => !r.allowedProgramIds.includes(id))) return deny('UNAPPROVED_PROGRAM');
  return deny('LIVE_SIGNING_NOT_IMPLEMENTED_OR_AUTHORIZED');
}
