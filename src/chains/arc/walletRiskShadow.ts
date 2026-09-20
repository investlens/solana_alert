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

/**
 * Shadow-only wallet risk assessment.
 *
 * This module intentionally does NOT make alert decisions. Missing evidence is
 * represented as null / NOT_CONFIRMED and must never be converted to 0 or SAFE.
 * Raw wallet/transaction evidence should remain ephemeral.
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
