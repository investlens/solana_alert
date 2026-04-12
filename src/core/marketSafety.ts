import type { MarketSafetyResult } from '../types.js';

export function computeMarketSafetyScore(input: {
  liquidityUsd: number;
  fdv: number;
  buys5m: number;
  sells5m: number;
  volume5m: number;
  paidApproved: boolean;
  hasProfileLinks: boolean;
  boosts: number;
}): MarketSafetyResult {
  let score = 0;

  const reasonsGood: string[] = [];
  const reasonsWarn: string[] = [];
  const reasonsBad: string[] = [];

  const fdvToLiq = input.liquidityUsd > 0 ? input.fdv / input.liquidityUsd : 99999;

  // 1) Liquidity quality
  if (input.liquidityUsd >= 20000) {
    score += 25;
    reasonsGood.push('Strong liquidity');
  } else if (input.liquidityUsd >= 10000) {
    score += 18;
    reasonsGood.push('Healthy liquidity');
  } else if (input.liquidityUsd >= 5000) {
    score += 10;
    reasonsWarn.push('Liquidity is acceptable but lower');
  } else {
    reasonsBad.push('Liquidity is weak');
  }

  // 2) Trading integrity
  if (input.volume5m >= 5000 && input.buys5m > input.sells5m) {
    score += 20;
    reasonsGood.push('Trading activity looks healthy');
  } else if (input.volume5m > 0) {
    score += 10;
    reasonsWarn.push('Trading activity is mixed');
  } else {
    reasonsBad.push('Trading activity is weak');
  }

  // 3) Flow quality
  if (input.buys5m >= input.sells5m * 1.5) {
    score += 15;
    reasonsGood.push('Buy pressure is strong');
  } else if (input.buys5m >= input.sells5m) {
    score += 10;
    reasonsGood.push('Buy pressure is positive');
  } else {
    reasonsWarn.push('Sell pressure needs watching');
  }

  // 4) FDV / liquidity sanity
  if (input.fdv > 0 && fdvToLiq <= 12) {
    score += 20;
    reasonsGood.push('Valuation looks reasonable');
  } else if (input.fdv > 0 && fdvToLiq <= 25) {
    score += 10;
    reasonsWarn.push('Valuation is acceptable');
  } else if (input.fdv > 0) {
    reasonsBad.push('Valuation looks stretched');
  } else {
    reasonsWarn.push('Valuation is unclear');
  }

  // 5) Paid approval / profile presence / boosts
  if (input.paidApproved) {
    score += 8;
    reasonsGood.push('Paid listing approval present');
  }

  if (input.hasProfileLinks) {
    score += 7;
    reasonsGood.push('Profile links are present');
  } else {
    reasonsWarn.push('Profile links are missing');
  }

  if (input.boosts > 0) {
    score += 5;
    reasonsWarn.push('Boosted visibility detected');
  }

  score = Math.max(0, Math.min(100, score));

  let marketSafetyLabel: MarketSafetyResult['marketSafetyLabel'] = 'RISKY';
  if (score >= 75) marketSafetyLabel = 'GOOD';
  else if (score >= 55) marketSafetyLabel = 'WATCH';

  return {
    marketSafetyScore: score,
    marketSafetyLabel,
    reasonsGood,
    reasonsWarn,
    reasonsBad,
  };
}