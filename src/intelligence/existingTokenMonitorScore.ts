export type ExistingTokenMonitorScore = {
  confidence: number;
  riskScore: number;
  provenance: {
    source: 'EXISTING_TOKEN_INTELLIGENCE_V1';
    state: string;
    observationCount: number;
    currentRoi: number | null;
    recentPeakRoi: number | null;
    retentionRatio: number | null;
    distanceFromAthMarketCapPct: number | null;
    volumeMultiple: number | null;
    buySellRatio: number | null;
    explicitCriticalRisk: boolean;
  };
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(value)));

const finiteNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const stateConfidence: Record<string, number> = {
  DISCOVERED: 30,
  FORMING: 45,
  BUILDING: 65,
  CONFIRMED: 82,
  RUNNER: 88,
  COOLING: 60,
  WEAKENING: 42,
  DANGER: 20,
};

const stateRisk: Record<string, number> = {
  DISCOVERED: 55,
  FORMING: 50,
  BUILDING: 40,
  CONFIRMED: 28,
  RUNNER: 35,
  COOLING: 48,
  WEAKENING: 70,
  DANGER: 92,
};

export function deriveExistingTokenMonitorScore(
  rawData: Record<string, unknown> | undefined,
): ExistingTokenMonitorScore {
  const raw = rawData ?? {};
  const state = String(
    raw.state ?? raw.intelligenceState ?? 'DISCOVERED',
  ).toUpperCase();

  const observations = Array.isArray(raw.observations)
    ? raw.observations
    : [];

  const currentRoi = finiteNumber(raw.currentRoi);
  const recentPeakRoi = finiteNumber(raw.recentPeakRoi);
  const distanceFromAthMarketCapPct = finiteNumber(
    raw.distanceFromAthMarketCapPct,
  );
  const volumeMultiple = finiteNumber(raw.volumeMultiple);
  const liquidity = finiteNumber(raw.liquidity);
  const buys5m = finiteNumber(raw.buys5m);
  const sells5m = finiteNumber(raw.sells5m);

  const retentionRatio =
    currentRoi != null &&
    recentPeakRoi != null &&
    recentPeakRoi > 0
      ? currentRoi / recentPeakRoi
      : null;

  const buySellRatio =
    buys5m != null &&
    sells5m != null
      ? buys5m / Math.max(1, sells5m)
      : null;

  const explicitCriticalRisk =
    raw.criticalSecurity === true ||
    raw.confirmedDevSell === true ||
    raw.liquidityCritical === true;

  let confidence = stateConfidence[state] ?? 40;
  let riskScore = stateRisk[state] ?? 60;

  // More independent observations make the current state classification
  // more trustworthy. This is confidence in the monitoring thesis, not
  // an entry recommendation.
  if (observations.length >= 6) confidence += 6;
  else if (observations.length >= 3) confidence += 4;
  else if (observations.length >= 2) confidence += 2;

  if (currentRoi != null) {
    if (currentRoi >= 20) confidence += 4;
    else if (currentRoi > 0) confidence += 2;
    else if (currentRoi <= -50) confidence -= 8;
    else if (currentRoi <= -20) confidence -= 4;

    if (currentRoi <= -50) riskScore += 15;
    else if (currentRoi <= -20) riskScore += 8;
  }

  if (retentionRatio != null) {
    if (retentionRatio >= 0.8) confidence += 4;
    else if (retentionRatio >= 0.5) confidence += 2;
    else if (retentionRatio < 0.25) confidence -= 6;
  }

  if (distanceFromAthMarketCapPct != null) {
    if (distanceFromAthMarketCapPct <= -75) riskScore += 15;
    else if (distanceFromAthMarketCapPct <= -50) riskScore += 12;
    else if (distanceFromAthMarketCapPct <= -25) riskScore += 6;
  }

  if (volumeMultiple != null) {
    if (volumeMultiple >= 1.5) confidence += 5;
    else if (volumeMultiple >= 1) confidence += 2;
    else if (volumeMultiple < 0.25) {
      confidence -= 5;
      riskScore += 8;
    }
  }

  if (buySellRatio != null) {
    if (buySellRatio >= 1.5) {
      confidence += 4;
      riskScore -= 4;
    } else if (
      sells5m != null &&
      buys5m != null &&
      sells5m > Math.max(1, buys5m) * 1.5
    ) {
      confidence -= 6;
      riskScore += 8;
    }
  }

  if (liquidity != null) {
    if (liquidity < 5_000) riskScore += 10;
    else if (liquidity < 10_000) riskScore += 5;
  }

  if (explicitCriticalRisk) {
    confidence = Math.min(confidence, 15);
    riskScore = raw.criticalSecurity === true || raw.confirmedDevSell === true
      ? 100
      : Math.max(riskScore, 95);
  }

  return {
    confidence: clamp(confidence, 5, 95),
    riskScore: clamp(riskScore),
    provenance: {
      source: 'EXISTING_TOKEN_INTELLIGENCE_V1',
      state,
      observationCount: observations.length,
      currentRoi,
      recentPeakRoi,
      retentionRatio,
      distanceFromAthMarketCapPct,
      volumeMultiple,
      buySellRatio,
      explicitCriticalRisk,
    },
  };
}
