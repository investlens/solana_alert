/** Paper-only reservation coordination. Never signs or broadcasts trades. */
import { validateSecureEchoBuy, type SecureEchoBuy } from './secureBuyGuard.js';
export interface EchoReservationStore {
  /** Atomically reserve executionWallet+mint. Return false on uniqueness conflict; throw on storage failure. */
  insertOnce(row: { executionWallet: string; mint: string; callerWallet: string; sourceSignature: string; amountLamports: number }): Promise<boolean>;
}
export async function reserveEchoPaperIntent(input: SecureEchoBuy, store: EchoReservationStore) {
  const admission = validateSecureEchoBuy(input);
  if (admission.allowed === false) return { reserved: false as const, reason: admission.reason };
  try {
    const inserted = await store.insertOnce({ executionWallet: input.ownerWallet, mint: input.event.mint,
      callerWallet: input.event.callerWallet, sourceSignature: input.event.transactionSignature,
      amountLamports: Math.round(input.event.amountSol * 1e9) });
    return inserted ? { reserved: true as const, key: admission.reservationKey } :
      { reserved: false as const, reason: 'DUPLICATE_TOKEN' };
  } catch {
    return { reserved: false as const, reason: 'STORAGE_UNAVAILABLE' };
  }
}
