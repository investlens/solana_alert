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
  recentRoiDeltaPct: number | null;
};

const MIN_AGE_SECONDS = 30 * 60;
const MIN_LIQUIDITY_USD = 2_000;
const MIN_VOLUME_5M_USD = 1_000;
const MIN_BUY_RATIO = 1.15;
const MIN_RECENT_ROI_DELTA_PCT = 1.5;

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure, zero-I/O reversal gate.
 *
 * Consumes only data already fetched/derived by the existing-token scanner.
 * No RPC, HTTP, database read or specialist lookup is performed here.
 */
export function assessLowLoadTrendReversal(input: LowLoadTrendReversalInput): LowLoadTrendReversalResult {
  if (input.ageSeconds < MIN_AGE_SECONDS) {
    return { eligible: false, reason: 'WAIT_30_MINUTES', buyRatio: null, recentRoiDeltaPct: null };
  }
  if (input.confirmedDevSell || input.criticalSecurity || input.liquidityCritical) {
    return { eligible: false, reason: 'KNOWN_RISK', buyRatio: null, recentRoiDeltaPct: null };
  }

  const liquidity = finitePositive(input.liquidityUsd);
  if (liquidity == null || liquidity < MIN_LIQUIDITY_USD) {
    return { eligible: false, reason: 'LIQUIDITY_TOO_LOW', buyRatio: null, recentRoiDeltaPct: null };
  }

  const volume = finitePositive(input.volume5mUsd);
  if (volume == null || volume < MIN_VOLUME_5M_USD) {
    return { eligible: false, reason: 'VOLUME_TOO_LOW', buyRatio: null, recentRoiDeltaPct: null };
  }

  const buys = finitePositive(input.buys5m) ?? 0;
  const sells = finitePositive(input.sells5m) ?? 0;
  const buyRatio = sells > 0 ? buys / sells : buys > 0 ? Number.POSITIVE_INFINITY : null;
  if (buyRatio == null || buyRatio < MIN_BUY_RATIO) {
    return { eligible: false, reason: 'BUY_PRESSURE_NOT_CONFIRMED', buyRatio, recentRoiDeltaPct: null };
  }

  const rows = [...(input.observations ?? [])].sort(
    (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
  );
  const currentRoi = finite(rows.at(-1)?.roi);
  const previousRoi = finite(rows.at(-2)?.roi);
  const recentRoiDeltaPct = currentRoi != null && previousRoi != null ? currentRoi - previousRoi : null;
  if (recentRoiDeltaPct == null || recentRoiDeltaPct < MIN_RECENT_ROI_DELTA_PCT) {
    return { eligible: false, reason: 'REVERSAL_NOT_CONFIRMED', buyRatio, recentRoiDeltaPct };
  }

  const recoveredState = ['COOLING', 'WEAKENING'].includes(input.previousState) &&
    ['BUILDING', 'CONFIRMED', 'RUNNER'].includes(input.currentState);
  if (!recoveredState) {
    return { eligible: false, reason: 'NO_RECOVERY_TRANSITION', buyRatio, recentRoiDeltaPct };
  }

  return { eligible: true, reason: 'TREND_REVERSAL_CONFIRMED', buyRatio, recentRoiDeltaPct };
}
