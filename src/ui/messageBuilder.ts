import type { DexPair, FreeTrialInfo, RiskResult, TokenState } from '../types.js';
import { renderAlphaNotification } from './alphaNotification.js';
import { formatUsd } from './alphaAlert/index.js';

export function buildMessage(args: {
  tier: 'OWNER' | 'PAID' | 'FREE';
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  freeTrialInfo?: FreeTrialInfo;
}): string {
  const { pair, result, tier } = args;
  const priority = result.score >= 82 && result.marketSafetyScore >= 70;
  return renderAlphaNotification({
    category: 'market',
    severity: priority ? 'positive' : 'watch',
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
    ],
    reason: 'AlphaOS detected qualified buyer momentum and market quality.',
    recommendedAction: 'Review live conditions before acting.',
    access: tier === 'FREE' ? 'FREE' : tier === 'PAID' ? 'PRO' : 'ADMIN',
  });
}
