import type { IntelligenceObservation, TokenIntelligenceState } from '../../intelligence/tokenIntelligenceState.js';

export type LowLoadTrendReversalInput = {
  observations?: IntelligenceObservation[];
  previousState: TokenIntelligenceState;
  currentState: TokenIntelligenceState;
  ageSeconds: number;
  liquidityUsd: number | null;
  volume5mUsd: number | null;
  buys5m: number | null;
  sells5m: number | null;
  confirmedDevSell?: boolean;
  criticalSecurity?: boolean;
  liquidityCritical?: boolean;
};

export type LowLoadTrendReversalResult = {
  eligible: boolean;
  reason: string;
  buyRatio: number | null;
  recentReturnPct: number | null;
};

const MIN_AGE_SECONDS = 30 * 60;
const MIN_LIQUIDITY_USD = 2_000;
const MIN_VOLUME_5M_USD = 1_000;
const MIN_BUY_RATIO = 1.15;
const MIN_RECENT_RETURN_PCT = 1.5;

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Pure, zero-I/O reversal gate.
 *
 * It intentionally consumes only data already fetched by the existing-token
 * scanner. No RPC, HTTP, database read or specialist lookup is performed here.
 * This keeps reversal intelligence cheap enough to run inside the existing
 * HOT/WARM observation stream.
 */
export function assessLowLoadTrendReversal(input: LowLoadTrendReversalInput): LowLoadTrendReversalResult {
  if (input.ageSeconds < MIN_AGE_SECONDS) {
    return { eligible: false, reason: 'WAIT_30_MINUTES', buyRatio: null, recentReturnPct: null };
  }
  if (input.confirmedDevSell || input.criticalSecurity || input.liquidityCritical) {
    return { eligible: false, reason: 'KNOWN_RISK', buyRatio: null, recentReturnPct: null };
  }

  const liquidity = finitePositive(input.liquidityUsd);
  if (liquidity == null || liquidity < MIN_LIQUIDITY_USD) {
    return { eligible: false, reason: 'LIQUIDITY_TOO_LOW', buyRatio: null, recentReturnPct: null };
  }

  const volume = finitePositive(input.volume5mUsd);
  if (volume == null || volume < MIN_VOLUME_5M_USD) {
    return { eligible: false, reason: 'VOLUME_TOO_LOW', buyRatio: null, recentReturnPct: null };
  }

  const buys = finitePositive(input.buys5m) ?? 0;
  const sells = finitePositive(input.sells5m) ?? 0;
  const buyRatio = sells > 0 ? buys / sells : buys > 0 ? Number.POSITIVE_INFINITY : null;
  if (buyRatio == null || buyRatio < MIN_BUY_RATIO) {
    return { eligible: false, reason: 'BUY_PRESSURE_NOT_CONFIRMED', buyRatio, recentReturnPct: null };
  }

  const observations = input.observations ?? [];
  const current = [...observations].reverse().find(row => finitePositive((row as IntelligenceObservation & { price?: number }).price));
  const previous = [...observations].slice(0, -1).reverse().find(row => finitePositive((row as IntelligenceObservation & { price?: number }).price));
  const currentPrice = finitePositive((current as IntelligenceObservation & { price?: number } | undefined)?.price);
  const previousPrice = finitePositive((previous as IntelligenceObservation & { price?: number } | undefined)?.price);
  const recentReturnPct = currentPrice && previousPrice ? (currentPrice - previousPrice) / previousPrice * 100 : null;
  if (recentReturnPct == null || recentReturnPct < MIN_RECENT_RETURN_PCT) {
    return { eligible: false, reason: 'PRICE_REVERSAL_NOT_CONFIRMED', buyRatio, recentReturnPct };
  }

  const recoveredState = ['COOLING', 'WEAKENING'].includes(input.previousState) &&
    ['BUILDING', 'CONFIRMED', 'RUNNER'].includes(input.currentState);
  if (!recoveredState) {
    return { eligible: false, reason: 'NO_RECOVERY_TRANSITION', buyRatio, recentReturnPct };
  }

  return { eligible: true, reason: 'TREND_REVERSAL_CONFIRMED', buyRatio, recentReturnPct };
}
