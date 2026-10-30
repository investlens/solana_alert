/** Preparation-only manual Telegram trade intent validation. No signing or broadcast. */
import { PublicKey } from '@solana/web3.js';
import { ECHO_EXPECTED_EXECUTION_WALLET, verifyEchoExecutionWallet } from './executionWallet.js';

export const ECHO_MANUAL_BUY_AMOUNTS_SOL = [0.05, 0.1] as const;
export const ECHO_MANUAL_TRADING_ENABLED = false as const;
export type ManualEchoIntent = {
  action: 'BUY' | 'SELL';
  telegramUserId: string;
  authorizedAdminId: string;
  executionWallet: string;
  mint: string;
  amountSol?: number;
  sellPercent?: number;
  confirmationTokenVerified: boolean;
};
export type ManualEchoDecision = { allowed: true; reservationKey: string } | { allowed: false; reason: string };
/** Checks an intent before any future quote, reservation, signing or submission. */
export function validateManualEchoIntent(input: ManualEchoIntent): ManualEchoDecision {
  if (!input.telegramUserId || !input.authorizedAdminId || input.telegramUserId !== input.authorizedAdminId)
    return { allowed: false, reason: 'UNAUTHORIZED_ADMIN' };
  if (!input.confirmationTokenVerified) return { allowed: false, reason: 'CONFIRMATION_REQUIRED' };
  if (!verifyEchoExecutionWallet(input.executionWallet, ECHO_EXPECTED_EXECUTION_WALLET))
    return { allowed: false, reason: 'EXECUTION_WALLET_MISMATCH' };
  try { new PublicKey(input.mint); }
  catch { return { allowed: false, reason: 'INVALID_MINT' }; }
  if (input.action === 'BUY') {
    if (input.sellPercent !== undefined || !ECHO_MANUAL_BUY_AMOUNTS_SOL.includes(input.amountSol as 0.05 | 0.1))
      return { allowed: false, reason: 'INVALID_BUY_AMOUNT' };
  } else if (input.action === 'SELL') {
    if (input.amountSol !== undefined || (input.sellPercent !== 50 && input.sellPercent !== 100))
      return { allowed: false, reason: 'INVALID_SELL_PERCENT' };
  } else return { allowed: false, reason: 'INVALID_ACTION' };
  return { allowed: true, reservationKey: input.executionWallet + ':' + input.mint };
}
