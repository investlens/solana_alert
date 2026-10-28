/**
 * Pure, deterministic transaction-ledger state transitions for future DB integration.
 * No database calls, signing, broadcasting, or live trading.
 * The durable database must enforce a UNIQUE (wallet,mint) reservation.
 */
export type IntentState =
  | 'reserved' | 'signed' | 'submitted' | 'confirmed'
  | 'failed_preflight' | 'unknown' | 'expired_unresolved';
export type IntentEvent =
  | 'PREFLIGHT_FAILED' | 'SIGNED_PERSISTED' | 'SUBMITTED'
  | 'CHAIN_CONFIRMED' | 'CONFIRMATION_UNKNOWN' | 'BLOCKHASH_EXPIRED_UNRESOLVED';
export type IntentRecord = Readonly<{
  executionWallet: string;
  mint: string;
  callerSignature: string;
  state: IntentState;
  signedSignature: string | null;
}>;
export type TransitionResult =
  | { ok: true; next: IntentRecord }
  | { ok: false; reason: string };
export function intentKey(wallet: string, mint: string): string {
  // For display and test only. Never use this as a substitute for DB uniqueness.
  return JSON.stringify([wallet, mint]);
}
export function transitionIntent(
  current: IntentRecord,
  event: IntentEvent,
  signedSignature?: string,
): TransitionResult {
  const deny = (reason: string): TransitionResult => ({ ok: false, reason });
  if (current.state === 'confirmed' || current.state === 'unknown' ||
      current.state === 'expired_unresolved' || current.state === 'failed_preflight')
    return deny('INTENT_LOCKED_REQUIRES_MANUAL_REVIEW');
  if (event === 'PREFLIGHT_FAILED' && current.state === 'reserved')
    return { ok: true, next: { ...current, state: 'failed_preflight' } };
  if (event === 'SIGNED_PERSISTED') {
    if (current.state !== 'reserved' || !signedSignature ||
        !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signedSignature))
      return deny('INVALID_SIGNED_TRANSITION');
    return { ok: true, next: { ...current, state: 'signed', signedSignature } };
  }
  if (event === 'SUBMITTED') {
    if (current.state !== 'signed' && current.state !== 'submitted') return deny('NOT_SIGNED');
    if (!current.signedSignature) return deny('MISSING_PERSISTED_SIGNATURE');
    if (signedSignature && signedSignature !== current.signedSignature) return deny('SIGNATURE_CHANGED');
    return { ok: true, next: { ...current, state: 'submitted' } };
  }
  if (event === 'CHAIN_CONFIRMED') {
    if (current.state !== 'signed' && current.state !== 'submitted') return deny('NOT_SUBMITTED_OR_SIGNED');
    if (!current.signedSignature || signedSignature !== current.signedSignature)
      return deny('SIGNATURE_MISMATCH');
    return { ok: true, next: { ...current, state: 'confirmed' } };
  }
  if (event === 'CONFIRMATION_UNKNOWN' && (current.state === 'signed' || current.state === 'submitted'))
    return { ok: true, next: { ...current, state: 'unknown' } };
  if (event === 'BLOCKHASH_EXPIRED_UNRESOLVED' && (current.state === 'signed' || current.state === 'submitted'))
    return { ok: true, next: { ...current, state: 'expired_unresolved' } };
  return deny('ILLEGAL_TRANSITION');
}
