import type { RiskResult, TokenState } from '../types.js';

export function captureAlertSnapshot(state: TokenState, result: RiskResult) {
  state.alertPrice = result.currentPrice;
  state.alertLiquidity = result.liquidityUsd;
  state.alertScore = result.score;
  state.alertBuys5m = result.buys5m;
  state.alertSells5m = result.sells5m;
}

export function getPerformance(state: TokenState, result: RiskResult) {
  const thenPrice = state.alertPrice ?? null;
  const nowPrice = result.currentPrice ?? null;

  const movePct =
    thenPrice != null && nowPrice != null && thenPrice > 0
      ? ((nowPrice - thenPrice) / thenPrice) * 100
      : null;

  let trend = 'UNCHANGED';
  if (movePct != null) {
    if (movePct > 3) trend = 'IMPROVING';
    else if (movePct < -3) trend = 'WEAKENING';
  }

  return {
    thenPrice,
    nowPrice,
    movePct,
    thenScore: state.alertScore ?? null,
    nowScore: result.score,
    trend,
  };
}