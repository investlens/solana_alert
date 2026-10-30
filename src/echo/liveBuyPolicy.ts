/**
 * Echo live-buy admission policy — intentionally does NOT submit transactions.
 * The execution-layer guard in src/core/adminTrading.ts remains unchanged.
 * This module can be used in shadow/paper mode until explicitly approved.
 */
import { ECHO_SHADOW_CALLER_WALLETS } from './callerRegistry.js';

export const SLINGOOR_WALLET = '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
export const CHAIRMAN_WALLET = 'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6';
export const ELIGIBLE_CALLER_WALLETS: ReadonlySet<string> = ECHO_SHADOW_CALLER_WALLETS;
export const MAX_SOL_PER_BUY = 0.1;
export const LIVE_EXECUTION_ENABLED = false as const;
export const AUTO_SELL_ENABLED = false as const;

export type BuyAdmission = {
  callerWallet: string;
  mint: string;
  amountSol: number;
  side: 'BUY' | 'SELL';
  isVerifiedSwap: boolean;
  transactionSignature: string;
};

export type AdmissionResult =
  | { allowed: true; key: string }
  | { allowed: false; reason: string };

export function validateBuyAdmission(
  event: BuyAdmission,
  ownerWallet: string,
): AdmissionResult {
  if (!ELIGIBLE_CALLER_WALLETS.has(event.callerWallet)) return { allowed: false, reason: 'CALLER_NOT_ELIGIBLE' };
  if (event.side !== 'BUY' || !event.isVerifiedSwap) return { allowed: false, reason: 'NOT_VERIFIED_BUY' };
  if (!Number.isFinite(event.amountSol) || event.amountSol <= 0 || event.amountSol > MAX_SOL_PER_BUY)
    return { allowed: false, reason: 'AMOUNT_OUT_OF_RANGE' };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ownerWallet) ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(event.mint) ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(event.transactionSignature))
    return { allowed: false, reason: 'INVALID_IDENTIFIER' };
  return { allowed: true, key: ownerWallet + ':' + event.mint };
}
