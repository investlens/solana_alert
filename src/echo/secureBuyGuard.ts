/** Pure, fail-closed guard. No wallet keys, signing, or transaction broadcast. */
import { validateEchoLandingBudget, type EchoLandingBudget } from './landingBudget.js';
import { validateBuyAdmission, type BuyAdmission } from './liveBuyPolicy.js';
export const MAX_DAILY_SPEND_SOL = 0.3;
export const MAX_SLIPPAGE_BPS = 300;
export const MAX_SIGNAL_AGE_MS = 3_000;
export type SecureEchoBuy = {
  event: BuyAdmission; ownerWallet: string; nowMs: number; observedAtMs: number;
  spentTodayLamports: number; walletBalanceLamports: number; reserveLamports: number;
  killSwitchEngaged: boolean; simulationPassed: boolean; quoteValid: boolean;
  mintAuthorityDisabled: boolean; freezeAuthorityDisabled: boolean;
  liquidityVerified: boolean; sellRouteVerified: boolean;
  slippageBps: number; landing: EchoLandingBudget;
};
export type SecureEchoDecision = { allowed: true; reservationKey: string; totalReservedLamports: number } |
  { allowed: false; reason: string };
export function validateSecureEchoBuy(input: SecureEchoBuy): SecureEchoDecision {
  if (input.killSwitchEngaged) return { allowed: false, reason: 'KILL_SWITCH' };
  const admitted = validateBuyAdmission(input.event, input.ownerWallet);
  if (admitted.allowed === false) return { allowed: false, reason: admitted.reason };
  if (![input.nowMs,input.observedAtMs,input.spentTodayLamports,input.walletBalanceLamports,input.reserveLamports,input.slippageBps].every(Number.isSafeInteger))
    return { allowed: false, reason: 'INVALID_NUMERIC_INPUT' };
  if (input.observedAtMs > input.nowMs || input.nowMs - input.observedAtMs > MAX_SIGNAL_AGE_MS)
    return { allowed: false, reason: 'STALE_SIGNAL' };
  if (!input.simulationPassed || !input.quoteValid || !input.mintAuthorityDisabled || !input.freezeAuthorityDisabled ||
      !input.liquidityVerified || !input.sellRouteVerified) return { allowed: false, reason: 'TOKEN_OR_ROUTE_UNVERIFIED' };
  if (input.slippageBps < 0 || input.slippageBps > MAX_SLIPPAGE_BPS) return { allowed: false, reason: 'SLIPPAGE_CAP' };
  const fee = validateEchoLandingBudget(input.landing);
  if (fee.allowed === false) return { allowed: false, reason: fee.reason };
  const lamports = Math.round(input.event.amountSol * 1e9);
  const reserved = lamports + fee.totalLandingLamports;
  if (input.spentTodayLamports < 0 || input.walletBalanceLamports < 0 || input.reserveLamports < 0 ||
      input.spentTodayLamports + reserved > MAX_DAILY_SPEND_SOL * 1e9 ||
      reserved + input.reserveLamports > input.walletBalanceLamports)
    return { allowed: false, reason: 'BALANCE_OR_DAILY_BUDGET' };
  return { allowed: true, reservationKey: admitted.key, totalReservedLamports: reserved };
}
