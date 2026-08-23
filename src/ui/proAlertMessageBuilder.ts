import type { DexPair, RiskResult, TokenState } from '../types.js';
import { renderAlphaNotification } from './alphaNotification.js';
import { marketContextMetrics, normalizeNotificationMarketContext } from './notificationMarketContext.js';
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
  const market = normalizeNotificationMarketContext(
    pair.baseToken as Record<string, unknown>,
    { marketCap: result.marketCap, fdv: result.fdv, liquidityUsd: result.liquidityUsd },
  );
  return renderAlphaNotification({
    category: 'market',
    severity: highPriority ? 'positive' : 'watch',
    state: 'ENTRY_READY',
    symbol: market.symbol,
    subtitle: market.name,
    address: market.address,
    age: Number.isFinite(result.ageMin) && result.ageMin >= 0 ? `${Math.round(result.ageMin)}m` : undefined,
    confidence: result.score,
    risk: `${result.marketSafetyLabel ?? result.risk ?? 'REVIEW'} · ${result.marketSafetyScore}/100`,
    metrics: [
      ...marketContextMetrics(market),
      ...(result.volume5m > 0 ? [{ label: '5m volume', value: formatUsd(result.volume5m) }] : []),
      { label: 'Buy / sell', value: ratio(result.buys5m, result.sells5m) },
    ],
    evidence: warning ? [warning] : [],
    reason: highPriority ? 'Priority momentum and market-quality checks passed.' : 'Momentum and market-quality checks passed.',
    recommendedAction: 'Verify live liquidity and price before acting.',
    access: 'PRO',
  });
}
