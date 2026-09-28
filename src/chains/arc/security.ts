import type { ArcTokenEnrichment } from './enrichment.js';

const ZERO = '0x0000000000000000000000000000000000000000';

export type ArcSecurityInput = ArcTokenEnrichment & {
  liquidityUsd?: number | null;
  volume5mUsd?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
  topHolderPct?: number | null;
  deployerPct?: number | null;
  liquidityLocked?: boolean | null;
  sellSimulationPassed?: boolean | null;
  externalRiskFlag?: boolean | null;
};

export type ArcSecurityDecision = {
  allowAlert: boolean;
  reasons: string[];
  warnings: string[];
};

const MIN_LIQUIDITY_USD = Number(process.env.ARC_MIN_LIQUIDITY_USD ?? 10_000);
const MIN_VOLUME_5M_USD = Number(process.env.ARC_MIN_VOLUME_5M_USD ?? 5_000);
const MIN_BUYS_5M = Number(process.env.ARC_MIN_BUYS_5M ?? 25);
const MAX_TOP_HOLDER_PCT = Number(process.env.ARC_MAX_TOP_HOLDER_PCT ?? 25);
const MAX_DEPLOYER_PCT = Number(process.env.ARC_MAX_DEPLOYER_PCT ?? 15);

export function evaluateArcSecurity(input: ArcSecurityInput): ArcSecurityDecision {
  const reasons = [...input.safetyReasons];
  const warnings: string[] = [];

  if (!input.contractCodePresent || !input.metadataReadable) reasons.push('INVALID_TOKEN_CONTRACT');
  if (input.hooks.toLowerCase() !== ZERO) reasons.push('UNVERIFIED_V4_HOOK');
  if (input.externalRiskFlag !== false) reasons.push(input.externalRiskFlag === true ? 'EXTERNAL_RISK_FLAG' : 'EXTERNAL_RISK_UNKNOWN');
  if (input.sellSimulationPassed !== true) reasons.push(input.sellSimulationPassed === false ? 'SELL_SIMULATION_FAILED' : 'SELL_SIMULATION_UNKNOWN');
  if (input.liquidityLocked !== true) reasons.push(input.liquidityLocked === false ? 'LIQUIDITY_NOT_LOCKED' : 'LIQUIDITY_LOCK_UNKNOWN');

  if (input.liquidityUsd == null) reasons.push('LIQUIDITY_UNKNOWN');
  else if (input.liquidityUsd < MIN_LIQUIDITY_USD) reasons.push('LOW_LIQUIDITY');

  if (input.volume5mUsd == null) reasons.push('VOLUME_UNKNOWN');
  else if (input.volume5mUsd < MIN_VOLUME_5M_USD) reasons.push('LOW_VOLUME');

  if (input.buys5m == null) reasons.push('BUYS_UNKNOWN');
  else if (input.buys5m < MIN_BUYS_5M) reasons.push('LOW_BUY_ACTIVITY');

  if (input.topHolderPct == null) reasons.push('HOLDER_CONCENTRATION_UNKNOWN');
  else if (input.topHolderPct > MAX_TOP_HOLDER_PCT) reasons.push('TOP_HOLDER_CONCENTRATION_HIGH');

  if (input.deployerPct == null) reasons.push('DEPLOYER_HOLDING_UNKNOWN');
  else if (input.deployerPct > MAX_DEPLOYER_PCT) reasons.push('DEPLOYER_HOLDING_HIGH');

  if (input.sells5m != null && input.buys5m != null && input.sells5m > input.buys5m * 1.5) {
    warnings.push('SELL_PRESSURE_ELEVATED');
  }

  return { allowAlert: reasons.length === 0, reasons: [...new Set(reasons)], warnings };
}
