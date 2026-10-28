/**
 * Read-only interpretation of externally initiated Phantom wallet transactions.
 * This module NEVER signs, broadcasts, modifies balances, or authorizes a new BUY.
 * Real integration must independently verify the chain transaction and balances.
 */
export type PhantomExitEvidence = Readonly<{
  wallet: string;
  expectedWallet: string;
  mint: string;
  transactionSignature: string;
  chain: 'solana-mainnet' | 'solana-devnet' | 'unknown';
  confirmed: boolean;
  transactionSucceeded: boolean;
  walletWasSigner: boolean;
  outgoingTokenAmountRaw: string;
  beforeTokenBalanceRaw: string;
  afterTokenBalanceRaw: string;
  trustedRpcEvidence: boolean;
  ledgerPositionMint: string;
}>;
export type ExitObservation = Readonly<{
  verifiedManualExit: boolean;
  closePositionEligible: boolean;
  reason: string;
}>;
const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const nonnegativeBigInt = (v: string): bigint | null => {
  if (!/^(0|[1-9]\d*)$/.test(v)) return null;
  try { return BigInt(v); } catch { return null; }
};
export function observePhantomManualExit(e: PhantomExitEvidence): ExitObservation {
  const reject = (reason: string): ExitObservation => ({ verifiedManualExit: false, closePositionEligible: false, reason });
  if (!address.test(e.wallet) || !address.test(e.mint) || !signature.test(e.transactionSignature) ||
      e.wallet !== e.expectedWallet || e.mint !== e.ledgerPositionMint) return reject('IDENTITY_MISMATCH');
  if (e.chain !== 'solana-mainnet' || !e.trustedRpcEvidence || !e.confirmed ||
      !e.transactionSucceeded || !e.walletWasSigner) return reject('UNVERIFIED_CHAIN_EVIDENCE');
  const before = nonnegativeBigInt(e.beforeTokenBalanceRaw);
  const after = nonnegativeBigInt(e.afterTokenBalanceRaw);
  const outgoing = nonnegativeBigInt(e.outgoingTokenAmountRaw);
  if (before === null || after === null || outgoing === null || outgoing === 0n ||
      after >= before || before - after !== outgoing) return reject('TOKEN_BALANCE_MISMATCH');
  return {
    verifiedManualExit: true,
    closePositionEligible: after === 0n,
    reason: after === 0n ? 'FULL_EXIT_OBSERVED' : 'PARTIAL_EXIT_OBSERVED',
  };
}
