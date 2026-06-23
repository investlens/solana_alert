export type ConfidenceInput = {
  score: number;
  creatorScore: number;
  smartWalletCount: number;
  liquidity: number;
  volume5m: number;
  buys5m: number;
  sells5m: number;
  socialScore: number;
  holderRiskScore: number;
  bundleRiskScore: number;
  marketCap: number | null;
  ageMin: number;
};

export type ConfidenceResult = {
  confidence: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function buyRatio(input: ConfidenceInput) {
  return input.sells5m <= 0 ? input.buys5m : input.buys5m / input.sells5m;
}

function sellBuyRatio(input: ConfidenceInput) {
  return input.buys5m <= 0 ? 999 : input.sells5m / input.buys5m;
}

export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  let confidence = 0;
  const reasons: string[] = [];

  if (input.creatorScore >= 80) {
    confidence += 25;
    reasons.push('Proven creator history');
  } else if (input.creatorScore >= 65) {
    confidence += 15;
    reasons.push('Promising creator history');
  } else {
    confidence += 5;
    reasons.push('Unknown creator');
  }

  if (input.smartWalletCount >= 3) {
    confidence += 25;
    reasons.push('Multiple smart wallets detected');
  } else if (input.smartWalletCount >= 1) {
    confidence += 12;
    reasons.push('Smart wallet activity detected');
  } else {
    reasons.push('No smart wallets detected yet');
  }

  if (input.volume5m >= 20_000) {
    confidence += 18;
    reasons.push('Strong 5m volume');
  } else if (input.volume5m >= 7_500) {
    confidence += 10;
    reasons.push('Healthy 5m volume');
  }

  if (buyRatio(input) >= 2.5 && sellBuyRatio(input) <= 0.4) {
    confidence += 18;
    reasons.push('Strong buy pressure');
  } else if (buyRatio(input) >= 1.5 && sellBuyRatio(input) <= 0.65) {
    confidence += 10;
    reasons.push('Positive buy pressure');
  } else {
    confidence -= 15;
    reasons.push('Weak or risky orderflow');
  }

  if (input.liquidity >= 20_000) {
    confidence += 10;
    reasons.push('Strong liquidity');
  } else if (input.liquidity >= 8_000) {
    confidence += 6;
    reasons.push('Acceptable liquidity');
  } else {
    confidence -= 10;
    reasons.push('Low liquidity');
  }

  if (input.socialScore >= 45) {
    confidence += 8;
    reasons.push('Strong socials');
  } else if (input.socialScore >= 25) {
    confidence += 4;
    reasons.push('Basic socials present');
  }

  if (input.marketCap && input.marketCap <= 120_000) {
    confidence += 6;
    reasons.push('Still early market cap');
  }

  if (input.ageMin <= 60) {
    confidence += 5;
    reasons.push('Fresh pair');
  } else {
    confidence -= 8;
    reasons.push('Older pair');
  }

  const riskPenalty =
    Math.max(0, input.holderRiskScore) +
    Math.max(0, input.bundleRiskScore);

  if (riskPenalty >= 100) {
    confidence -= 30;
    reasons.push('High combined risk');
  } else if (riskPenalty >= 50) {
    confidence -= 15;
    reasons.push('Medium combined risk');
  }

  confidence = clamp(confidence);

  const riskLevel =
    riskPenalty >= 80 || sellBuyRatio(input) > 0.75
      ? 'HIGH'
      : riskPenalty >= 40 || sellBuyRatio(input) > 0.6
        ? 'MEDIUM'
        : 'LOW';

  return {
    confidence: Math.round(confidence),
    riskLevel,
    reasons: reasons.slice(0, 6),
  };
}