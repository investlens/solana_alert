export type ArcWalletRiskState = 'VERIFIED' | 'RISK_DETECTED' | 'NOT_CONFIRMED';

export type ArcWalletRiskAssessment = {
  state: ArcWalletRiskState;
  creatorHoldingPct: number | null;
  topHolderPct: number | null;
  top5HolderPct: number | null;
  connectedClusterPct: number | null;
  earlyBuyerConcentrationPct: number | null;
  dumpResistance: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT_DATA';
  evidence: string[];
};

export type ArcWalletRiskEvidence = {
  creatorHoldingPct?: number | null;
  topHolderPct?: number | null;
  top5HolderPct?: number | null;
  connectedClusterPct?: number | null;
  earlyBuyerConcentrationPct?: number | null;
  largestClusterValueUsd?: number | null;
  liquidityUsd?: number | null;
  evidence?: string[];
};

const finitePct = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

const finitePositive = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Shadow-only wallet risk assessment.
 * Missing evidence is null / NOT_CONFIRMED and is never converted to 0 or SAFE.
 * No value returned here is allowed to block an alert.
 */
export function unavailableArcWalletRisk(reason = 'wallet evidence not queried'): ArcWalletRiskAssessment {
  return {
    state: 'NOT_CONFIRMED',
    creatorHoldingPct: null,
    topHolderPct: null,
    top5HolderPct: null,
    connectedClusterPct: null,
    earlyBuyerConcentrationPct: null,
    dumpResistance: 'INSUFFICIENT_DATA',
    evidence: [reason],
  };
}

/**
 * Converts ephemeral evidence into a compact shadow result.
 *
 * These thresholds are OBSERVATION labels only while we calibrate against
 * MINARA and successful ARC calls. They MUST NOT be used as production alert
 * blockers without an explicit later decision.
 */
export function assessArcWalletRiskShadow(input: ArcWalletRiskEvidence): ArcWalletRiskAssessment {
  const creatorHoldingPct = finitePct(input.creatorHoldingPct);
  const topHolderPct = finitePct(input.topHolderPct);
  const top5HolderPct = finitePct(input.top5HolderPct);
  const connectedClusterPct = finitePct(input.connectedClusterPct);
  const earlyBuyerConcentrationPct = finitePct(input.earlyBuyerConcentrationPct);
  const largestClusterValueUsd = finitePositive(input.largestClusterValueUsd);
  const liquidityUsd = finitePositive(input.liquidityUsd);
  const exitVsLiquidity = largestClusterValueUsd != null && liquidityUsd != null
    ? largestClusterValueUsd / liquidityUsd
    : null;

  const coreAvailable = topHolderPct != null && top5HolderPct != null;
  const clusterAvailable = connectedClusterPct != null;
  const exitAvailable = exitVsLiquidity != null;

  if (!coreAvailable) {
    return {
      state: 'NOT_CONFIRMED',
      creatorHoldingPct,
      topHolderPct,
      top5HolderPct,
      connectedClusterPct,
      earlyBuyerConcentrationPct,
      dumpResistance: 'INSUFFICIENT_DATA',
      evidence: [...(input.evidence ?? []), 'core holder concentration not confirmed'],
    };
  }

  const highConcentration =
    topHolderPct >= 15 ||
    top5HolderPct >= 35 ||
    (connectedClusterPct != null && connectedClusterPct >= 20) ||
    (earlyBuyerConcentrationPct != null && earlyBuyerConcentrationPct >= 30);
  const highExitRisk = exitVsLiquidity != null && exitVsLiquidity >= 0.75;
  const moderateRisk =
    topHolderPct >= 8 ||
    top5HolderPct >= 20 ||
    (connectedClusterPct != null && connectedClusterPct >= 10) ||
    (earlyBuyerConcentrationPct != null && earlyBuyerConcentrationPct >= 20) ||
    (exitVsLiquidity != null && exitVsLiquidity >= 0.35);

  const state: ArcWalletRiskState = highConcentration || highExitRisk ? 'RISK_DETECTED' : 'VERIFIED';
  const dumpResistance = !clusterAvailable || !exitAvailable
    ? 'INSUFFICIENT_DATA'
    : highConcentration || highExitRisk
      ? 'WEAK'
      : moderateRisk
        ? 'MODERATE'
        : 'STRONG';

  return {
    state,
    creatorHoldingPct,
    topHolderPct,
    top5HolderPct,
    connectedClusterPct,
    earlyBuyerConcentrationPct,
    dumpResistance,
    evidence: [
      ...(input.evidence ?? []),
      ...(exitVsLiquidity != null ? [`largest cluster / liquidity = ${exitVsLiquidity.toFixed(2)}x`] : ['exit/liquidity evidence not confirmed']),
    ],
  };
}

export function formatArcWalletRiskShadow(risk: ArcWalletRiskAssessment): string[] {
  const pct = (value: number | null) => value == null ? 'Not confirmed' : `${value.toFixed(2)}%`;
  return [
    '[ArcWalletRiskShadow]',
    `state=${risk.state}`,
    `creatorHolding=${pct(risk.creatorHoldingPct)}`,
    `topHolder=${pct(risk.topHolderPct)}`,
    `top5=${pct(risk.top5HolderPct)}`,
    `connectedCluster=${pct(risk.connectedClusterPct)}`,
    `earlyBuyerConcentration=${pct(risk.earlyBuyerConcentrationPct)}`,
    `dumpResistance=${risk.dumpResistance}`,
  ];
}
