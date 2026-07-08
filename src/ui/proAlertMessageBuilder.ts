import type { DexPair, RiskResult, TokenState } from '../types.js';

function divider() {
  return '━━━━━━━━━━━━━━━━━━';
}

function fmtUsd(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'n/a';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function pct(buys: number, sells: number) {
  if (sells <= 0) return `${buys.toFixed(0)}x`;
  return `${(buys / sells).toFixed(2)}x`;
}

function verdict(result: RiskResult) {
  if (result.score >= 82) return 'High-conviction setup. Strong momentum and healthy early structure.';
  if (result.score >= 72) return 'Qualified opportunity. Watch entry carefully and manage risk.';
  return 'Watch only. Needs stronger confirmation.';
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

  const lines: string[] = [];

  lines.push('🧠 <b>ALPHAOS AI</b>');
  lines.push(divider());
  lines.push(bucket === 'HIGH_BUY' ? '🚀 <b>HIGH BUY SIGNAL</b>' : '🟢 <b>BUY SIGNAL</b>');
  lines.push('');
  lines.push(`🪙 <b>${symbol}</b>`);
  lines.push(`<i>${name}</i>`);
  lines.push('');
  lines.push(`⏱ Age: <b>${Math.floor(result.ageMin)}m</b>`);
  lines.push(`⭐ Alpha Score: <b>${result.score}/100</b>`);
  lines.push(`🛡 Risk: <b>${result.risk}</b>`);
  lines.push(divider());

  lines.push('📊 <b>Market</b>');
  lines.push(`Market Cap: <b>${fmtUsd(result.marketCap || result.fdv)}</b>`);
  lines.push(`Liquidity: <b>${fmtUsd(result.liquidityUsd)}</b>`);
  lines.push(`5m Volume: <b>${fmtUsd(result.volume5m)}</b>`);
  lines.push(`Buy Ratio: <b>${pct(result.buys5m, result.sells5m)}</b>`);
  lines.push(`Buys/Sells: <b>${result.buys5m}/${result.sells5m}</b>`);
  lines.push(divider());

  lines.push('🧠 <b>AI Verdict</b>');
  lines.push(verdict(result));
  lines.push('');

  if (result.checksGood.length) {
    lines.push('<b>Why AlphaOS likes it</b>');
    lines.push(...result.checksGood.slice(0, 4).map((x) => `✅ ${x}`));
  }

  if (result.checksWarn.length || result.checksBad.length) {
    lines.push('');
    lines.push('<b>Risks / Watch</b>');
    lines.push(...[...result.checksWarn, ...result.checksBad].slice(0, 4).map((x) => `⚠️ ${x}`));
  }

  lines.push(divider());
  lines.push('📚 <b>Alpha Memory</b>');
  lines.push('Tracking this token after alert.');
  lines.push('Timeline updates will improve future decisions.');

  return lines.join('\n');
}