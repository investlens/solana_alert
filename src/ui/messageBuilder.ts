import type { DexPair, FreeTrialInfo, RiskResult, TokenState } from '../types.js';
import { renderAlphaNotification } from './alphaNotification.js';
import { formatUsd } from './alphaAlert/index.js';
import { marketContextMetrics, normalizeNotificationMarketContext } from './notificationMarketContext.js';

export function buildMessage(args: {
  tier: 'OWNER' | 'PAID' | 'FREE';
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  freeTrialInfo?: FreeTrialInfo;
}): string {
  const { pair, result, tier } = args;
  const priority = result.score >= 82 && result.marketSafetyScore >= 70;
  const market = normalizeNotificationMarketContext(
    pair.baseToken as Record<string, unknown>,
    { marketCap: result.marketCap, fdv: result.fdv, liquidityUsd: result.liquidityUsd },
  );
  return renderAlphaNotification({
    category: 'market',
    severity: priority ? 'positive' : 'watch',
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
    ],
    reason: 'AlphaOS detected qualified buyer momentum and market quality.',
    recommendedAction: 'Review live conditions before acting.',
    access: tier === 'FREE' ? 'FREE' : tier === 'PAID' ? 'PRO' : 'ADMIN',
  });
}
