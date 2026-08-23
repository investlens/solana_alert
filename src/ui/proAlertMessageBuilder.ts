import type { DexPair, RiskResult, TokenState } from '../types.js';
import { renderAlphaNotification } from './alphaNotification.js';
import { formatUsd } from './alphaAlert/index.js';

function ratio(buys: number, sells: number): string {
  if (sells <= 0) return buys > 0 ? `${buys.toFixed(0)}x` : '-';
  return `${(buys / sells).toFixed(2)}x`;
}

export function buildProAlertMessage(args: {
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  bucket: 'BUY' | 'HIGH_BUY' | 'IGNORE';
}): string {
  const { pair, result, bucket } = args;
  const highPriority = bucket === 'HIGH_BUY';
  const warning = [...(result.checksBad ?? []), ...(result.checksWarn ?? [])]
    .map(value => String(value ?? '').trim()).find(Boolean);
  return renderAlphaNotification({
    category: 'market',
    severity: highPriority ? 'positive' : 'watch',
    state: 'ENTRY_READY',
    symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
    subtitle: pair.baseToken?.name,
    address: pair.baseToken?.address,
    confidence: result.score,
    risk: `${result.marketSafetyLabel ?? result.risk ?? 'REVIEW'} · ${result.marketSafetyScore}/100`,
    metrics: [
      { label: 'Market cap', value: formatUsd(result.marketCap > 0 ? result.marketCap : result.fdv) },
      { label: 'Liquidity', value: formatUsd(result.liquidityUsd) },
      { label: '5m volume', value: formatUsd(result.volume5m) },
      { label: 'Buy / sell', value: ratio(result.buys5m, result.sells5m) },
    ],
    evidence: warning ? [warning] : [],
    reason: highPriority ? 'Priority momentum and market-quality checks passed.' : 'Momentum and market-quality checks passed.',
    recommendedAction: 'Verify live liquidity and price before acting.',
    access: 'PRO',
  });
}
