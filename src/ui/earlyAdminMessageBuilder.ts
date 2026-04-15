import type { DexPair, RiskResult, TokenState } from '../types.js';
import { escapeHtml, fmtPrice, fmtUsd } from '../utils/format.js';

function divider() {
  return '━━━━━━━━━━━━━━━';
}

function fmtPct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function buildEarlyAdminMessage(args: {
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
}) {
  const { pair, result } = args;

  const name = pair.baseToken?.name || pair.baseToken?.symbol || 'Unknown';
  const symbol = pair.baseToken?.symbol || name;
  const marketCapText =
    result.marketCap && result.marketCap > 0
      ? fmtUsd(result.marketCap)
      : result.fdv && result.fdv > 0
      ? fmtUsd(result.fdv)
      : 'n/a';

  const lines: string[] = [];

  lines.push('🧪 <b>EARLY PAIR WATCH</b>');
  lines.push(divider());
  lines.push(`<b>${escapeHtml(name)} • ${escapeHtml(symbol)}</b>`);
  lines.push('');

  lines.push(`<b>Liquidity</b>  ${escapeHtml(fmtUsd(result.liquidityUsd))}`);
  lines.push(`<b>Price</b>  ${escapeHtml(fmtPrice(result.currentPrice))}`);
  lines.push(`<b>MCap</b>  ${escapeHtml(marketCapText)}`);
  lines.push(`<b>Age</b>  ${Math.floor(result.ageMin)}m`);
  lines.push('');

  lines.push(`<b>Buys/Sells</b>  ${result.buys5m}/${result.sells5m}`);
  lines.push(`<b>Vol 5m</b>  ${escapeHtml(fmtUsd(result.volume5m))}`);
  lines.push(`<b>Setup</b>  ${result.score}`);
  lines.push(`<b>Safety</b>  ${result.marketSafetyScore} (${result.marketSafetyLabel})`);
  lines.push('');

  lines.push('✅ Pair is fresh');
  lines.push('✅ Liquidity formed');
  lines.push('⚠️ Early and volatile');
  lines.push('');

  if (pair.url) lines.push(`📈 ${escapeHtml(pair.url)}`);
  if (pair.baseToken?.address) {
    lines.push(`🟢 https://jup.ag/swap/SOL-${pair.baseToken.address}`);
  }

  return lines.join('\n');
}