import { formatUsd } from './alphaAlert/index.js';
import type { AlphaNotificationMetric } from './alphaNotification.js';

export type MarketValuationState =
  | 'VERIFIED_PONS_CURVE'
  | 'VERIFIED_DEX'
  | 'VERIFYING'
  | 'DISPUTED'
  | 'UNAVAILABLE';

export type NotificationMarketContext = {
  symbol: string | null;
  name: string | null;
  address: string | null;
  price: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidity: number | null;
  volume5m: number | null;
  chartUrl: string | null;
  valuationState?: MarketValuationState;
  valuationSource?: 'PONS_V2_CURVE_RESERVE_SPOT' | 'DEX_MARKET' | null;
  preIndexValuation?: {
    type: 'MARKET_CAP' | 'FDV';
    valueUsd: number;
    observedAt: string;
  } | null;
};

export type CoreDecisionMetricContext = {
  devHoldingPercent: number | null;
  devHoldingEvidence: 'VERIFIED' | 'UNAVAILABLE' | 'UNCONFIRMED';
  burnedPercent: number | null;
  burnEvidence: 'VERIFIED' | 'UNAVAILABLE' | 'UNCONFIRMED';
};

type MarketContextSource = Record<string, unknown> | null | undefined;

export const PONS_PREINDEX_LIFECYCLE_MAX_AGE_MS = 10 * 60 * 1000;
const MIN_MEANINGFUL_DEX_LIQUIDITY_USD = 500;
const STRONG_DEX_LIQUIDITY_USD = 2_500;
const MIN_LIQUIDITY_TO_VALUATION_RATIO = 0.02;
const MATERIAL_VALUATION_DISAGREEMENT = 0.35;

export function verifiedPonsPreIndexValuation(
  source: MarketContextSource,
  tokenAddress?: string | null,
  now = Date.now(),
): NotificationMarketContext['preIndexValuation'] {
  const value = source?.preIndexValuation;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const observedAt = new Date(String(record.observedAt ?? '')).getTime();
  const valueUsd = Number(record.valueUsd);
  const type = String(record.valuationType ?? '');
  const matchingToken = !tokenAddress ||
    String(record.tokenAddress ?? '').toLowerCase() === tokenAddress.toLowerCase();
  const validProvenance = record.indexed === false &&
    record.source === 'PONS_V2_CURVE_RESERVE_SPOT' &&
    record.tokenPriceSource === 'PONS_V2_CURVE_RESERVE_RATIO' &&
    typeof record.quoteAsset === 'string' && Boolean(record.quoteAsset) &&
    typeof record.quoteUsdSource === 'string' && Boolean(record.quoteUsdSource);
  const fresh = Number.isFinite(observedAt) && now - observedAt >= 0 &&
    now - observedAt <= PONS_PREINDEX_LIFECYCLE_MAX_AGE_MS;
  if (!matchingToken || !validProvenance || !fresh || !Number.isFinite(valueUsd) || valueUsd <= 0) return null;
  if (type !== 'MARKET_CAP' && type !== 'FDV') return null;
  return { type, valueUsd, observedAt: new Date(observedAt).toISOString() };
}

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
      const raw = source[key];
      if (raw == null || raw === '') continue;
      const value = Number(raw);
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

export function isEconomicallyMeaningfulDexValuation(args: {
  valuationUsd: number | null;
  liquidityUsd: number | null;
}): boolean {
  if (args.valuationUsd == null || !Number.isFinite(args.valuationUsd) || args.valuationUsd <= 0) return false;
  // Do not downgrade producers that genuinely have no liquidity observation. The
  // credibility guard activates only when a measured pool-liquidity value exists.
  if (args.liquidityUsd == null) return true;
  if (!Number.isFinite(args.liquidityUsd) || args.liquidityUsd <= 0) return false;
  if (args.liquidityUsd >= STRONG_DEX_LIQUIDITY_USD) return true;
  return args.liquidityUsd >= MIN_MEANINGFUL_DEX_LIQUIDITY_USD &&
    args.liquidityUsd / args.valuationUsd >= MIN_LIQUIDITY_TO_VALUATION_RATIO;
}

function materiallyDisagrees(a: number, b: number): boolean {
  const denominator = Math.max(a, b);
  return denominator > 0 && Math.abs(a - b) / denominator > MATERIAL_VALUATION_DISAGREEMENT;
}

export function normalizeNotificationMarketContext(
  ...sources: MarketContextSource[]
): NotificationMarketContext {
  const address = text(sources, ['address', 'tokenAddress', 'token_address', 'mint', 'asset_id']);
  const price = positiveNumber(sources, ['price', 'priceUsd', 'price_usd', 'currentPrice']);
  const dexMarketCap = positiveNumber(sources, [
    'marketCap', 'marketCapUsd', 'market_cap', 'currentMarketCap', 'current_market_cap',
    'entryMarketCap', 'entry_market_cap',
  ]);
  const dexFdv = positiveNumber(sources, ['fdv', 'fdvUsd', 'fdv_usd']);
  const liquidity = positiveNumber(sources, [
    'liquidity', 'liquidityUsd', 'liquidity_usd', 'currentLiquidity', 'current_liquidity',
    'entryLiquidity', 'entry_liquidity',
  ]);
  const preIndexValuation = sources
    .map(source => verifiedPonsPreIndexValuation(source, address))
    .find(Boolean) ?? null;
  const dexComparable = dexMarketCap ?? dexFdv;
  const dexValuationCredible = isEconomicallyMeaningfulDexValuation({
    valuationUsd: dexComparable,
    liquidityUsd: liquidity,
  });

  let marketCap: number | null = null;
  let fdv: number | null = null;
  let valuationState: MarketValuationState = 'UNAVAILABLE';
  let valuationSource: NotificationMarketContext['valuationSource'] = null;

  if (preIndexValuation) {
    const comparableDex = preIndexValuation.type === 'MARKET_CAP' ? dexMarketCap : dexFdv;
    if (comparableDex != null && dexValuationCredible && materiallyDisagrees(preIndexValuation.valueUsd, comparableDex)) {
      valuationState = 'DISPUTED';
    } else {
      valuationState = 'VERIFIED_PONS_CURVE';
      valuationSource = 'PONS_V2_CURVE_RESERVE_SPOT';
      if (preIndexValuation.type === 'MARKET_CAP') marketCap = preIndexValuation.valueUsd;
      else fdv = preIndexValuation.valueUsd;
    }
  } else if (dexComparable != null) {
    if (dexValuationCredible) {
      valuationState = 'VERIFIED_DEX';
      valuationSource = 'DEX_MARKET';
      marketCap = dexMarketCap;
      fdv = dexFdv;
    } else {
      // Keep the opportunity signal alive but do not present a thin/dust-pool
      // valuation as an actionable market cap.
      valuationState = 'VERIFYING';
    }
  }

  return {
    symbol: text(sources, ['symbol', 'tokenSymbol', 'token_symbol'])?.replace(/^UNKNOWN$/i, '') || null,
    name: text(sources, ['name', 'tokenName', 'token_name'])?.replace(/^Unknown Token$/i, '') || null,
    address,
    price,
    marketCap,
    fdv,
    liquidity,
    volume5m: positiveNumber(sources, [
      'volume5m', 'volume5mUsd', 'volume_5m', 'volume_5m_usd',
    ]),
    chartUrl: httpsUrl(sources, ['chartUrl', 'marketUrl', 'chart_url', 'market_url']),
    valuationState,
    valuationSource,
    preIndexValuation,
  };
}

export function marketContextMetrics(
  context: Pick<NotificationMarketContext,
    'marketCap' | 'fdv' | 'liquidity' | 'volume5m' | 'preIndexValuation' | 'valuationState'>,
): AlphaNotificationMetric[] {
  const preIndexUsd = (value: number): string => {
    if (value >= 1_000 && value < 10_000) return `$${(value / 1_000).toFixed(2)}K`;
    return formatUsd(value);
  };
  const valuationFormatter = context.preIndexValuation ? preIndexUsd : formatUsd;
  const valuationStatus = context.valuationState === 'DISPUTED'
    ? [{ label: 'Valuation', value: 'DISPUTED' }]
    : context.valuationState === 'VERIFYING'
      ? [{ label: 'Valuation', value: 'VERIFYING' }]
      : [];
  return [
    ...valuationStatus,
    ...(context.marketCap == null ? [] : [{ label: 'Market cap', value: valuationFormatter(context.marketCap) }]),
    ...(context.marketCap != null || context.fdv == null ? [] : [{ label: 'FDV', value: valuationFormatter(context.fdv) }]),
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
