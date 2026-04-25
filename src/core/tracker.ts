import type { RiskResult, TokenState } from '../types.js';

export function captureAlertSnapshot(state: TokenState, result: RiskResult) {
  state.alertPrice = result.currentPrice ?? null;
  state.alertLiquidity = result.liquidityUsd;
  state.alertScore = result.score;
  state.alertBuys5m = result.buys5m;
  state.alertSells5m = result.sells5m;
}

export function getPerformance(state: TokenState, result: RiskResult) {
  const alertPrice = state.alertPrice ?? result.currentPrice ?? null;
  const currentPrice = result.currentPrice ?? null;

  let movePct: number | null = null;
  if (
    alertPrice != null &&
    currentPrice != null &&
    Number.isFinite(alertPrice) &&
    Number.isFinite(currentPrice) &&
    alertPrice > 0
  ) {
    movePct = ((currentPrice - alertPrice) / alertPrice) * 100;
  }

  return {
    thenPrice: alertPrice,
    nowPrice: currentPrice,
    movePct,
    trend:
      movePct == null ? 'n/a' : movePct > 0 ? 'up' : movePct < 0 ? 'down' : 'flat',
  };
}