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
