import { config } from '../config.js';
import type { DexPair, FreeTrialInfo, RiskResult, TokenState } from '../types.js';
import { fmtPrice } from '../utils/format.js';
import { buildAlphaAlert, formatUsd } from './alphaAlert/index.js';

function getActionBucket(result: RiskResult): 'BUY' | 'HIGH_BUY' {
  return result.score >= 82 && result.marketSafetyScore >= 75 && result.authoritySafetyScore >= 40 ? 'HIGH_BUY' : 'BUY';
}

function flowLabel(
  buys: number,
  sells: number,
): string {
  if (buys >= sells * 2) {
    return 'Strong Buyer Pressure';
  }

  if (buys > sells) {
    return 'Buyer Momentum';
  }

  if (buys === sells) {
    return 'Balanced Flow';
  }

  return 'Seller Pressure';
}

function upgradeLine(freeTrialInfo?: FreeTrialInfo): string | null {
  if (!freeTrialInfo) return null;
  if (freeTrialInfo.fastDelayActive) return `Trial: ${freeTrialInfo.used}/${freeTrialInfo.limit} fast alerts used · /upgrade`;
  return 'Free alerts are delayed · Upgrade for earlier intelligence · /upgrade';
}

export function buildMessage(args: {
  tier: 'OWNER' | 'PAID' | 'FREE';
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  freeTrialInfo?: FreeTrialInfo;
}): string {
  const { tier, pair, result, freeTrialInfo } = args;
  const name = pair.baseToken?.name || pair.baseToken?.symbol || 'Unknown';
  const symbol = pair.baseToken?.symbol || name;
  const address = pair.baseToken?.address ?? null;
  const bucket = getActionBucket(result);
  const marketCap = result.marketCap && result.marketCap > 0 ? result.marketCap : result.fdv;
  const evidence: string[] = [];

  if (result.marketSafetyLabel === 'GOOD') {
    evidence.push('✅ Healthy market structure');
  } else if (result.marketSafetyLabel === 'WATCH') {
    evidence.push('⚠️ Market structure needs confirmation');
  }

  if (result.liquidityUsd >= 5000) {
    evidence.push('✅ Liquidity threshold cleared');
  }

  if (result.buys5m > result.sells5m) {
    evidence.push('✅ Positive buyer pressure');
  }

  if (bucket === 'HIGH_BUY') {
    evidence.push('✅ Priority setup threshold reached');
  }

  const trial = tier === 'FREE' ? upgradeLine(freeTrialInfo) : null;
  const sponsor = config.sponsor.title ? `Partner: ${config.sponsor.title}` : null;

  return buildAlphaAlert({
    title: bucket === 'HIGH_BUY' ? 'MARKET RADAR · PRIORITY' : 'MARKET RADAR · WATCHLIST',
    subtitle: 'Qualified market structure detected',
    tone: bucket === 'HIGH_BUY'
  ? 'POSITIVE'
  : 'POSITIVE',
    symbol,
    name,
    address,
    score: result.score,
    confidence: result.score,
    risk: `${result.marketSafetyLabel} · ${result.marketSafetyScore}/100`,
    status: bucket === 'HIGH_BUY' ? 'PRIORITY INVESTIGATION' : 'WORTH INVESTIGATING',
    sections: [
      {
        title: 'MARKET SNAPSHOT',
        icon: '📊',
        metrics: [
          { label: 'Market Cap', value: formatUsd(marketCap) },
          { label: 'Liquidity', value: formatUsd(result.liquidityUsd) },
          { label: 'Price', value: fmtPrice(result.currentPrice) },
          { label: 'Age', value: `${Math.floor(result.ageMin)}m` },
          { label: '5m Volume', value: formatUsd(result.volume5m) },
          { label: 'Buys / Sells', value: `${result.buys5m}/${result.sells5m}` },
          { label: 'Order Flow', value: flowLabel(result.buys5m, result.sells5m) },
        ],
      },
      { title: 'WHY ALPHAOS FLAGGED IT', icon: '🔎', items: evidence.slice(0, 4) },
      { title: 'ACCESS', icon: '🔐', items: [trial, sponsor].filter((x): x is string => Boolean(x)) },
    ],
    verdictTitle: bucket === 'HIGH_BUY' ? 'HIGH-PRIORITY INVESTIGATION' : 'WORTH INVESTIGATING',
    verdict: 'AlphaOS detected qualified evidence. Confirm wallet, creator and holder risk before taking action.',
    tracking: 'CONTINUOUS OUTCOME TRACKING ACTIVE',
  });
}
