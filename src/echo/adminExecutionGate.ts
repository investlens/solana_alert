/**
 * Read-only safety gate for the future Echo executor.
 * It NEVER signs, submits, reserves, or modifies any live position.
 */
import { ECHO_ADMIN_PILOT, evaluateEchoAdminPilot, type EchoAdminPilotInput } from './adminPilotConfig.js';
export type ExecutionSnapshot = EchoAdminPilotInput & {
  databaseHealthy: boolean;
  signerHealthy: boolean;
  rpcHealthy: boolean;
  reconciliationHealthy: boolean;
  emergencyStop: boolean;
  quoteAgeMs: number;
  maxQuoteAgeMs: number;
  expectedFeeLamports: number;
  maxFeeLamports: number;
  availableSol: number;
  minSolReserve: number;
  priceImpactBps: number;
  observedPriceMoveBps: number;
  maxObservedPriceMoveBps: number;
  liquidityUsd: number;
  minimumLiquidityUsd: number;
  sellRouteVerified: boolean;
  tokenSafetyVerified: boolean;
  tokenMint: string;
  executionWallet: string;
  callerSignature: string;
  eventAgeMs: number;
  maxEventAgeMs: number;
  dailySpendSol: number;
  maxDailySpendSol: number;
  dailyMarkedLossSol: number;
  lossMarkFresh: boolean;
};
export type ExecutionGate = { readyForShadow: boolean; reason: string; liveExecutionAllowed: false };
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const sig58 = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const valid = (x: number) => Number.isFinite(x) && x >= 0;
export function evaluateExecutionGate(s: ExecutionSnapshot): ExecutionGate {
  const deny = (reason: string): ExecutionGate => ({ readyForShadow: false, reason, liveExecutionAllowed: false });
  const admission = evaluateEchoAdminPilot(s);
  if (!admission.eligibleForFutureActivation) return deny(admission.reason);
  if (s.emergencyStop) return deny('EMERGENCY_STOP');
  if (!s.databaseHealthy || !s.signerHealthy || !s.rpcHealthy || !s.reconciliationHealthy) return deny('DEPENDENCY_UNHEALTHY');
  if (!base58.test(s.tokenMint) || !base58.test(s.executionWallet) || !sig58.test(s.callerSignature)) return deny('INVALID_ONCHAIN_ID');
  if (!s.tokenSafetyVerified || !s.sellRouteVerified) return deny('TOKEN_OR_EXIT_UNVERIFIED');
  if (!s.lossMarkFresh || !valid(s.dailyMarkedLossSol) ||
      s.dailyMarkedLossSol >= ECHO_ADMIN_PILOT.dailyLossCircuitBreakerSol) return deny('LOSS_BREAKER');
  if (![s.quoteAgeMs,s.maxQuoteAgeMs,s.eventAgeMs,s.maxEventAgeMs,s.expectedFeeLamports,s.maxFeeLamports,
        s.availableSol,s.minSolReserve,s.priceImpactBps,s.observedPriceMoveBps,s.maxObservedPriceMoveBps,
        s.liquidityUsd,s.minimumLiquidityUsd,s.dailySpendSol,s.maxDailySpendSol].every(valid)) return deny('INVALID_MARKET_OR_BUDGET');
  if (s.maxQuoteAgeMs <= 0 || s.maxEventAgeMs <= 0 || s.quoteAgeMs > s.maxQuoteAgeMs ||
      s.eventAgeMs > s.maxEventAgeMs) return deny('STALE_EVENT_OR_QUOTE');
  if (s.expectedFeeLamports > s.maxFeeLamports) return deny('FEE_CAP');
  if (s.priceImpactBps > ECHO_ADMIN_PILOT.maxSlippageBps ||
      s.observedPriceMoveBps > s.maxObservedPriceMoveBps) return deny('PRICE_MOVEMENT');
  if (s.liquidityUsd < s.minimumLiquidityUsd || s.minimumLiquidityUsd <= 0) return deny('INSUFFICIENT_LIQUIDITY');
  if (s.availableSol < s.amountSol + s.minSolReserve + s.expectedFeeLamports / 1e9) return deny('INSUFFICIENT_BALANCE');
  if (s.dailySpendSol + s.amountSol > s.maxDailySpendSol || s.maxDailySpendSol <= 0) return deny('DAILY_SPEND_LIMIT');
  return { readyForShadow: true, reason: 'SHADOW_ONLY_EXECUTION_DISABLED', liveExecutionAllowed: false };
}
