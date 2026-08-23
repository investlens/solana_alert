import { formatUsd } from './alphaAlert/index.js';
import type { AlphaNotificationMetric } from './alphaNotification.js';

export type NotificationMarketContext = {
  symbol: string | null;
  name: string | null;
  address: string | null;
  marketCap: number | null;
  liquidity: number | null;
  volume5m: number | null;
  chartUrl: string | null;
};

export type CoreDecisionMetricContext = {
  devHoldingPercent: number | null;
  devHoldingEvidence: 'VERIFIED' | 'UNAVAILABLE' | 'UNCONFIRMED';
  burnedPercent: number | null;
  burnEvidence: 'VERIFIED' | 'UNAVAILABLE' | 'UNCONFIRMED';
};

type MarketContextSource = Record<string, unknown> | null | undefined;

function text(sources: MarketContextSource[], keys: string[]): string | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

function httpsUrl(sources: MarketContextSource[], keys: string[]): string | null {
  const value = text(sources, keys);
  return value && /^https:\/\//i.test(value) ? value : null;
}

function positiveNumber(sources: MarketContextSource[], keys: string[]): number | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = Number(source[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function nonNegativeNumber(sources: MarketContextSource[], keys: string[]): number | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      if (source[key] == null || source[key] === '') continue;
      const value = Number(source[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }
  return null;
}

function evidenceState(
  sources: MarketContextSource[],
  explicitKeys: string[],
  measuredStatuses: string[],
): CoreDecisionMetricContext['devHoldingEvidence'] {
  for (const source of sources) {
    if (!source) continue;
    for (const key of explicitKeys) {
      const value = String(source[key] ?? '').toUpperCase();
      if (value === 'VERIFIED') return 'VERIFIED';
      if (value === 'UNAVAILABLE') return 'UNAVAILABLE';
      if (value === 'UNCONFIRMED') return 'UNCONFIRMED';
      if (measuredStatuses.includes(value)) return 'VERIFIED';
    }
  }
  return 'UNCONFIRMED';
}

export function normalizeNotificationMarketContext(
  ...sources: MarketContextSource[]
): NotificationMarketContext {
  return {
    symbol: text(sources, ['symbol', 'tokenSymbol', 'token_symbol'])?.replace(/^UNKNOWN$/i, '') || null,
    name: text(sources, ['name', 'tokenName', 'token_name'])?.replace(/^Unknown Token$/i, '') || null,
    address: text(sources, ['address', 'tokenAddress', 'token_address', 'mint', 'asset_id']),
    marketCap: positiveNumber(sources, [
      'marketCap', 'marketCapUsd', 'market_cap', 'currentMarketCap', 'current_market_cap',
      'entryMarketCap', 'entry_market_cap', 'fdv',
    ]),
    liquidity: positiveNumber(sources, [
      'liquidity', 'liquidityUsd', 'liquidity_usd', 'currentLiquidity', 'current_liquidity',
      'entryLiquidity', 'entry_liquidity',
    ]),
    volume5m: positiveNumber(sources, [
      'volume5m', 'volume5mUsd', 'volume_5m', 'volume_5m_usd',
    ]),
    chartUrl: httpsUrl(sources, ['chartUrl', 'marketUrl', 'chart_url', 'market_url']),
  };
}

export function marketContextMetrics(
  context: Pick<NotificationMarketContext, 'marketCap' | 'liquidity' | 'volume5m'>,
): AlphaNotificationMetric[] {
  return [
    ...(context.marketCap == null ? [] : [{ label: 'Market cap', value: formatUsd(context.marketCap) }]),
    ...(context.liquidity == null ? [] : [{ label: 'Liquidity', value: formatUsd(context.liquidity) }]),
    ...(context.volume5m == null ? [] : [{ label: '5m volume', value: formatUsd(context.volume5m) }]),
  ];
}

export function normalizeCoreDecisionMetrics(
  ...sources: MarketContextSource[]
): CoreDecisionMetricContext {
  const devHoldingPercent = nonNegativeNumber(sources, [
    'devHoldingPercent', 'dev_holding_percent', 'developerHoldingPercent',
  ]);
  const burnedPercent = nonNegativeNumber(sources, [
    'burnedPercent', 'burnPercent', 'totalBurnPercent', 'burned_supply_percent',
  ]);
  return {
    devHoldingPercent,
    devHoldingEvidence: devHoldingPercent == null
      ? 'UNAVAILABLE'
      : evidenceState(sources, ['devHoldingEvidence', 'devHoldingStatus', 'devFlowEvidenceStatus'], [
          'KNOWN', 'ZERO', 'COMPLETE', 'BALANCES_ONLY',
        ]),
    burnedPercent,
    burnEvidence: burnedPercent == null
      ? 'UNAVAILABLE'
      : evidenceState(sources, ['burnEvidence', 'devFlowEvidenceStatus'], ['COMPLETE', 'BALANCES_ONLY']),
  };
}

function percent(value: number): string {
  return `${Number(value.toFixed(2)).toString()}%`;
}

export function coreDecisionEvidenceMetrics(
  context: CoreDecisionMetricContext,
): AlphaNotificationMetric[] {
  return [
    ...(context.devHoldingEvidence === 'VERIFIED' && context.devHoldingPercent != null
      ? [{ label: 'Dev holding', value: percent(context.devHoldingPercent) }]
      : []),
    ...(context.burnEvidence === 'VERIFIED' && context.burnedPercent != null
      ? [{ label: 'Burned', value: percent(context.burnedPercent) }]
      : []),
  ];
}
