import type { DexPair, RiskResult, TokenState } from '../types.js';
import { buildAlphaAlert, formatUsd } from './alphaAlert/index.js';

function ratio(buys: number, sells: number): string {
  if (sells <= 0) return buys > 0 ? `${buys.toFixed(0)}x` : 'Tracking';
  return `${(buys / sells).toFixed(2)}x`;
}

function verdict(result: RiskResult): { title: string; text: string } {
  if (result.score >= 82) return { title: 'HIGH-PRIORITY INVESTIGATION', text: 'Strong momentum and healthy early structure detected. Confirm holder and creator risk before acting.' };
  if (result.score >= 72) return { title: 'WORTH INVESTIGATING', text: 'A qualified opportunity is forming. Entry timing and risk confirmation still matter.' };
  return { title: 'MONITOR FOR CONFIRMATION', text: 'The setup needs stronger evidence before it deserves priority.' };
}

export function buildProAlertMessage(args: {
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  bucket: 'BUY' | 'HIGH_BUY' | 'IGNORE';
}) {
  const { pair, result, bucket } = args;
  const symbol = pair.baseToken?.symbol ?? 'UNKNOWN';
  const name = pair.baseToken?.name ?? symbol;
  const address = pair.baseToken?.address ?? null;
  const assessment = verdict(result);

  return buildAlphaAlert({
    title: bucket === 'HIGH_BUY' ? 'AI DISCOVERY · PRIORITY' : 'AI DISCOVERY · WATCHLIST',
    subtitle: 'Multi-factor opportunity detected',
    tone: bucket === 'HIGH_BUY' ? 'PREMIUM' : 'POSITIVE',
    symbol,
    name,
    address,
    score: result.score,
    confidence: result.score,
    risk: String(result.risk ?? 'Tracking'),
    status: bucket === 'HIGH_BUY' ? 'PRIORITY REVIEW' : 'ACTIVE WATCH',
    sections: [
      {
        title: 'MARKET SNAPSHOT',
        icon: '📊',
        metrics: [
          { label: 'Market Cap', value: formatUsd(result.marketCap || result.fdv) },
          { label: 'Liquidity', value: formatUsd(result.liquidityUsd) },
          { label: '5m Volume', value: formatUsd(result.volume5m) },
          { label: 'Buy Ratio', value: ratio(result.buys5m, result.sells5m) },
          { label: 'Buys / Sells', value: `${result.buys5m}/${result.sells5m}` },
          { label: 'Age', value: `${Math.floor(result.ageMin)}m` },
        ],
      },
      { title: 'SUPPORTING EVIDENCE', icon: '✅', items: result.checksGood.slice(0, 4).map((x) => `✅ ${x}`) },
      { title: 'RISKS TO VERIFY', icon: '⚠️', items: [...result.checksWarn, ...result.checksBad].slice(0, 4).map((x) => `⚠️ ${x}`) },
    ],
    verdictTitle: assessment.title,
    verdict: assessment.text,
    tracking: 'ALPHA MEMORY TRACKING ACTIVE',
  });
}
