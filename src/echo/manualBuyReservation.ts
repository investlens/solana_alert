/** Manual BUY reservation: no signing, execution, or Telegram callbacks. */
import { validateManualEchoIntent, type ManualEchoIntent } from './manualTradeIntent.js';
import type { EchoReservationStore } from './paperReservation.js';
import { ECHO_MANUAL_TRADING_ENABLED } from './manualTradeIntent.js';
export type ManualBuyReservation = ManualEchoIntent & {
  action: 'BUY'; callerWallet: string; sourceSignature: string;
};
export async function reserveManualEchoBuy(input: ManualBuyReservation, store: EchoReservationStore) {
  const decision = validateManualEchoIntent(input);
  if (decision.allowed === false) return { reserved: false as const, reason: decision.reason };
  // The approval flag gates execution, not dry-run reservation testing.
  if (ECHO_MANUAL_TRADING_ENABLED !== false) return { reserved: false as const, reason: 'UNEXPECTED_EXECUTION_MODE' };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.callerWallet) ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(input.sourceSignature))
    return { reserved: false as const, reason: 'INVALID_SOURCE' };
  try {
    const inserted = await store.insertOnce({
      executionWallet: input.executionWallet, mint: input.mint,
      callerWallet: input.callerWallet, sourceSignature: input.sourceSignature,
      amountLamports: Math.round(input.amountSol! * 1e9),
    });
    return inserted ? { reserved: true as const, key: decision.reservationKey } :
      { reserved: false as const, reason: 'DUPLICATE_TOKEN' };
  } catch {
    return { reserved: false as const, reason: 'STORAGE_UNAVAILABLE' };
  }
}
