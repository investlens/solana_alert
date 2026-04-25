import { config } from '../config.js';
import { getPerformance } from '../core/tracker.js';
import type { DexPair, FreeTrialInfo, RiskResult, TokenState } from '../types.js';
import { escapeHtml, fmtPrice, fmtUsd } from '../utils/format.js';

function getActionBucket(result: RiskResult): 'BUY' | 'HIGH_BUY' {
  if (
    result.score >= 82 &&
    result.marketSafetyScore >= 75 &&
    result.authoritySafetyScore >= 40
  ) {
    return 'HIGH_BUY';
  }

  return 'BUY';
}

function getHeader(bucket: 'BUY' | 'HIGH_BUY') {
  if (bucket === 'HIGH_BUY') return '🚀 <b>HIGH BUY</b>';
  return '🟢 <b>BUY</b>';
}

function divider() {
  return '━━━━━━━━━━━━━━━';
}

function getFlowLabel(buys: number, sells: number) {
  if (buys >= sells * 1.8) return 'Strong buy pressure';
  if (buys > sells) return 'Buy pressure positive';
  if (buys === sells) return 'Balanced flow';
  return 'Sell pressure rising';
}

function getCompactFlags(result: RiskResult): string[] {
  const flags: string[] = [];

  if (result.marketSafetyLabel === 'GOOD') {
    flags.push('✅ Market structure looks healthy');
  } else if (result.marketSafetyLabel === 'WATCH') {
    flags.push('⚠️ Market structure needs watching');
  }

  if (result.liquidityUsd >= 5000) {
    flags.push('✅ Liquidity looks strong');
  } else if (result.liquidityUsd >= 2000) {
    flags.push('✅ Liquidity formed');
  }

  if (flags.length < 2 && result.buys5m > result.sells5m) {
    flags.push('✅ Buy pressure is positive');
  }

  return flags.slice(0, 2);
}

function buildUpgradeLine(freeTrialInfo?: FreeTrialInfo) {
  if (!freeTrialInfo) return '';

  if (freeTrialInfo.fastDelayActive) {
    return `🧪 Trial <b>${freeTrialInfo.used}/${freeTrialInfo.limit}</b> fast alerts used • <b>/upgrade</b>`;
  }

  return `🔒 Free is delayed • Paid gets this earlier • <b>/upgrade</b>`;
}

function formatMetricRow(label: string, value: string) {
  return `<b>${escapeHtml(label)}</b>  ${escapeHtml(value)}`;
}

export function buildMessage(args: {
  tier: 'OWNER' | 'PAID' | 'FREE';
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  freeTrialInfo?: FreeTrialInfo;
}): string {
  const { tier, pair, result, state, freeTrialInfo } = args;

  const name = pair.baseToken?.name || pair.baseToken?.symbol || 'Unknown';
  const symbol = pair.baseToken?.symbol || name;
  const perf = getPerformance(state, result);
  const bucket = getActionBucket(result);
  const flags = getCompactFlags(result);
  const marketCapText =
    result.marketCap && result.marketCap > 0
      ? fmtUsd(result.marketCap)
      : result.fdv && result.fdv > 0
      ? fmtUsd(result.fdv)
      : 'n/a';

  const lines: string[] = [];

  lines.push(getHeader(bucket));
  lines.push(divider());
  lines.push(`<b>${escapeHtml(name)} • ${escapeHtml(symbol)}</b>`);
  lines.push('');

  lines.push(formatMetricRow('Liquidity', fmtUsd(result.liquidityUsd)));
  lines.push(formatMetricRow('Price', fmtPrice(result.currentPrice)));
  lines.push(formatMetricRow('MCap', marketCapText));
  lines.push(formatMetricRow('Age', `${Math.floor(result.ageMin)}m`));
  lines.push('');

  lines.push(formatMetricRow('Buys/Sells', `${result.buys5m}/${result.sells5m}`));
  lines.push(formatMetricRow('Vol 5m', fmtUsd(result.volume5m)));
  lines.push(formatMetricRow('Flow', getFlowLabel(result.buys5m, result.sells5m)));
  lines.push('');

  lines.push(formatMetricRow('Alert Price', fmtPrice(perf.thenPrice)));
  lines.push(formatMetricRow('Highest After', 'Tracking...'));
  lines.push(formatMetricRow('Current Price', fmtPrice(perf.nowPrice)));
  lines.push('');

  lines.push(formatMetricRow('Setup', String(result.score)));
  lines.push(
    formatMetricRow(
      'Safety',
      `${result.marketSafetyScore} (${result.marketSafetyLabel})`
    )
  );
  lines.push('');

  for (const flag of flags) {
    lines.push(flag);
  }

  if (bucket === 'HIGH_BUY') {
    lines.push('🔥 Highest priority setup');
  }

  lines.push('');
  lines.push(divider());

  if (pair.url) {
    lines.push(`📈 ${escapeHtml(pair.url)}`);
  }

  if (pair.baseToken?.address) {
    lines.push(`🟢 https://jup.ag/swap/SOL-${pair.baseToken.address}`);
  }

  if (tier === 'FREE') {
    const upgradeLine = buildUpgradeLine(freeTrialInfo);
    if (upgradeLine) {
      lines.push('');
      lines.push(upgradeLine);
    }
  }

  if (config.sponsor.title) {
    lines.push('');
    lines.push(`• ${escapeHtml(config.sponsor.title)}`);
  }

  return lines.join('\n');
}