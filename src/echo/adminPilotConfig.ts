/**
 * Admin-only Echo real-money pilot configuration.
 * Preparation ONLY: no signer, RPC broadcaster, or execution path is wired here.
 * Production execution must remain disabled until separately approved.
 */
export const ECHO_ADMIN_PILOT = Object.freeze({
  executionEnabled: false as const,
  automaticBuyRequested: true,
  automaticSellEnabled: false as const,
  adminOnly: true as const,
  callerWallets: Object.freeze([
    '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij', // Slingoor
    'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6', // Chairman
  ]),
  solPerBuy: 0.1,
  maxSlippageBps: 300,
  maxOpenPositions: 2,
  dailyLossCircuitBreakerSol: 0.15,
  autoSell: false as const,
  duplicateScope: 'execution-wallet-and-mint' as const,
});

export type EchoAdminPilotInput = {
  callerWallet: string;
  side: 'BUY' | 'SELL';
  verifiedSwap: boolean;
  amountSol: number;
  slippageBps: number;
  openPositions: number;
  dailyRealizedLossSol: number;
  alreadyReserved: boolean;
  adminAuthorized: boolean;
};
export type EchoAdminPilotDecision = { eligibleForFutureActivation: boolean; reason: string };
/** Evaluates shadow admission only; never authorizes live execution. */
export function evaluateEchoAdminPilot(input: EchoAdminPilotInput): EchoAdminPilotDecision {
  const reject = (reason: string): EchoAdminPilotDecision => ({ eligibleForFutureActivation: false, reason });
  if (!input.adminAuthorized) return reject('ADMIN_ONLY');
  if (!ECHO_ADMIN_PILOT.callerWallets.includes(input.callerWallet)) return reject('CALLER_NOT_ALLOWED');
  if (input.side !== 'BUY' || !input.verifiedSwap) return reject('NOT_VERIFIED_BUY');
  if (input.alreadyReserved) return reject('DUPLICATE_TOKEN');
  if (!Number.isFinite(input.amountSol) || input.amountSol <= 0 || input.amountSol > ECHO_ADMIN_PILOT.solPerBuy) return reject('AMOUNT_LIMIT');
  if (!Number.isFinite(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > ECHO_ADMIN_PILOT.maxSlippageBps) return reject('SLIPPAGE_LIMIT');
  if (!Number.isInteger(input.openPositions) || input.openPositions < 0 || input.openPositions >= ECHO_ADMIN_PILOT.maxOpenPositions) return reject('POSITION_LIMIT');
  if (!Number.isFinite(input.dailyRealizedLossSol) || input.dailyRealizedLossSol < 0 || input.dailyRealizedLossSol >= ECHO_ADMIN_PILOT.dailyLossCircuitBreakerSol) return reject('DAILY_LOSS_LIMIT');
  return { eligibleForFutureActivation: true, reason: 'SHADOW_ELIGIBLE_EXECUTION_DISABLED' };
}
