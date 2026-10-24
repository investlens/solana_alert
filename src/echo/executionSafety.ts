/** Research-only execution safety assessment, NOT a profitable-signal predictor.
 * This module cannot submit an order and is never wired into the live Echo alert path.
 */
export type EchoExecutionEvidence = {
  verifiedSwap: boolean;
  reliableTokenMint: boolean;
  quoteFreshSeconds: number | null;
  liquidityUsd: number | null;
  simulatedBuyImpactPct: number | null;
  simulatedSellImpactPct: number | null;
  roundTripFeePct: number | null;
  canSimulateBuy: boolean;
  canSimulateSell: boolean;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  concentrationChecked: boolean;
};
export type EchoSafetyPolicy = {
  maxQuoteAgeSeconds: number;
  minLiquidityUsd: number;
  maxBuyImpactPct: number;
  maxSellImpactPct: number;
  maxRoundTripFeePct: number;
};
export type EchoSafetyDecision = { eligibleForManualReview: boolean; reasons: string[]; automatedTradeAllowed: false };
/** Fail-closed on absent evidence; numerical limits are test policies, not backtested production thresholds. */
export function assessEchoExecutionSafety(e: EchoExecutionEvidence, policy: EchoSafetyPolicy): EchoSafetyDecision {
  const reasons: string[] = [];
  const bounded = (x: number | null, low=0) => x !== null && Number.isFinite(x) && x >= low;
  if (!e.verifiedSwap || !e.reliableTokenMint) reasons.push('unverified_trade');
  if (!bounded(e.quoteFreshSeconds) || e.quoteFreshSeconds! > policy.maxQuoteAgeSeconds) reasons.push('stale_or_missing_quote');
  if (!bounded(e.liquidityUsd) || e.liquidityUsd! < policy.minLiquidityUsd) reasons.push('insufficient_or_unknown_liquidity');
  if (!e.canSimulateBuy || !e.canSimulateSell) reasons.push('unverified_round_trip_sellability');
  if (!bounded(e.simulatedBuyImpactPct) || e.simulatedBuyImpactPct! > policy.maxBuyImpactPct) reasons.push('buy_price_impact');
  if (!bounded(e.simulatedSellImpactPct) || e.simulatedSellImpactPct! > policy.maxSellImpactPct) reasons.push('sell_price_impact');
  if (!bounded(e.roundTripFeePct) || e.roundTripFeePct! > policy.maxRoundTripFeePct) reasons.push('round_trip_costs');
  if (e.mintAuthorityDisabled !== true || e.freezeAuthorityDisabled !== true) reasons.push('token_authority_unverified');
  if (!e.concentrationChecked) reasons.push('holder_concentration_unverified');
  if (Object.values(policy).some(v=>!Number.isFinite(v) || v<=0)) reasons.push('invalid_policy');
  return {eligibleForManualReview: reasons.length===0,reasons,automatedTradeAllowed:false};
}
