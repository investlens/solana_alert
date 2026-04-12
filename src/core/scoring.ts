import { config } from '../config.js';
import type { DexPair, DexProfile, RiskResult } from '../types.js';
import { computeMarketSafetyScore } from './marketSafety.js';

export function scoreToken(args: {
  pair: DexPair;
  profile: DexProfile;
  paidApproved: boolean;
  boostAmount: number;
  hasTakeover: boolean;
}): RiskResult {
  const { pair, profile, paidApproved, boostAmount, hasTakeover } = args;

  const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
  const pairCreatedAt = Number(pair.pairCreatedAt ?? 0);
  const ageMin = pairCreatedAt ? Math.max(0, (Date.now() - pairCreatedAt) / 60_000) : 99999;
  const buys5m = Number(pair.txns?.m5?.buys ?? 0);
  const sells5m = Number(pair.txns?.m5?.sells ?? 0);
  const volume5m = Number(pair.volume?.m5 ?? 0);
  const fdv = Number(pair.fdv ?? 0);
  const marketCap = Number(pair.marketCap ?? 0);
  const boosts = Number(pair.boosts?.active ?? 0) + (boostAmount > 0 ? 1 : 0);
  const hasProfileLinks = Boolean(profile.url || (profile.links && profile.links.length > 0));
  const fdvToLiq = liquidityUsd > 0 ? fdv / liquidityUsd : 99999;
  const currentPrice = pair.priceUsd ? Number(pair.priceUsd) : null;

  let score = 0;
  const checksGood: string[] = [];
  const checksWarn: string[] = [];

  const marketSafety = computeMarketSafetyScore({
    liquidityUsd,
    fdv,
    buys5m,
    sells5m,
    volume5m,
    paidApproved,
    hasProfileLinks,
    boosts,
  });

  const checksBad: string[] = [];
  

  if (liquidityUsd >= config.minLiqUsd * 2) {
    score += 20;
    checksGood.push(`Strong liquidity ${liquidityUsd.toFixed(0)}`);
  } else if (liquidityUsd >= config.minLiqUsd) {
    score += 14;
    checksGood.push(`Liquidity above floor ${liquidityUsd.toFixed(0)}`);
  } else {
    checksBad.push(`Low liquidity ${liquidityUsd.toFixed(0)}`);
  }

  if (ageMin <= Math.min(5, config.maxAgeMin)) {
    score += 10;
    checksGood.push(`Very early (${Math.floor(ageMin)} min)`);
  } else if (ageMin <= config.maxAgeMin) {
    score += 7;
    checksGood.push(`Fresh pair (${Math.floor(ageMin)} min)`);
  } else {
    checksBad.push(`Too old for early alert (${Math.floor(ageMin)} min)`);
  }

  if (buys5m >= 25 && buys5m > sells5m * 1.5) {
    score += 18;
    checksGood.push(`Buy pressure positive (${buys5m}/${sells5m})`);
  } else if (buys5m > sells5m) {
    score += 10;
    checksGood.push(`Buys lead sells (${buys5m}/${sells5m})`);
  } else if (buys5m === 0 && sells5m === 0) {
    checksWarn.push('Very low txn activity');
  } else {
    checksBad.push(`Sell pressure weakens setup (${buys5m}/${sells5m})`);
  }

  if (volume5m >= config.min5mVolume * 2) {
    score += 12;
    checksGood.push(`Strong 5m volume ${volume5m.toFixed(0)}`);
  } else if (volume5m >= config.min5mVolume) {
    score += 8;
    checksGood.push(`Healthy 5m volume ${volume5m.toFixed(0)}`);
  } else {
    checksWarn.push(`Light 5m volume ${volume5m.toFixed(0)}`);
  }

  if (fdv > 0 && fdvToLiq <= 12) {
    score += 10;
    checksGood.push(`FDV/liquidity sane (${fdvToLiq.toFixed(1)}x)`);
  } else if (fdv > 0 && fdvToLiq <= config.maxFdvToLiq) {
    score += 5;
    checksWarn.push(`FDV elevated vs liquidity (${fdvToLiq.toFixed(1)}x)`);
  } else if (fdv > 0) {
    checksBad.push(`FDV too stretched (${fdvToLiq.toFixed(1)}x)`);
  }

  if (paidApproved) {
    score += 4;
    checksGood.push('Paid order approved');
  } else {
    checksWarn.push('No approved paid order');
  }

  if (boosts > 0 || hasTakeover) {
    score += 5;
    checksGood.push(hasTakeover ? 'Community takeover detected' : 'Boost activity detected');
  }

  if (hasProfileLinks) {
    score += 5;
    checksGood.push('Profile/social links present');
  } else {
    checksWarn.push('No visible profile/social links');
  }

  const symbol = (pair.baseToken?.symbol ?? '').toUpperCase();
  const suspiciousWords = ['RUG', 'SCAM', 'TEST'];
  if (suspiciousWords.some((w) => symbol.includes(w))) {
    checksBad.push('Suspicious branding');
  }

  if (checksBad.length >= 2) score -= 10;
  score = Math.max(0, Math.min(100, score));

  let risk: RiskResult['risk'] = 'HIGH';
  let action: RiskResult['action'] = 'SKIP';
  if (score >= 82) {
    risk = 'LOW';
    action = 'WATCH';
  } else if (score >= 68) {
    risk = 'MEDIUM';
    action = 'MANUAL BUY ONLY';
  }

  return {
    score,
    risk,
    action,
    checksGood,
    checksWarn,
    checksBad,
    liquidityUsd,
    ageMin,
    buys5m,
    sells5m,
    marketSafetyScore: marketSafety.marketSafetyScore,
    marketSafetyLabel: marketSafety.marketSafetyLabel,
    volume5m,
    boosts,
    paidApproved,
    hasProfileLinks,
    fdv,
    marketCap,
    currentPrice,
  };
}

