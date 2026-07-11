import type { TerminalStats } from './terminalStats.js';

function divider() {
  return '━━━━━━━━━━━━━━━━━━';
}

function fmtUsd(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'Tracking';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function shortToken(token?: string | null) {
  if (!token) return 'n/a';
  return token.length > 14
    ? `${token.slice(0, 6)}...${token.slice(-6)}`
    : token;
}

function apiIcon(status: string) {
  if (status === 'OK') return '✅';
  if (status === 'RATE_LIMITED') return '⚠️';
  if (status === 'QUOTA_EXCEEDED') return '⛔';
  return '❔';
}

export function buildTerminalMessage(stats: TerminalStats) {
  const lines: string[] = [];

  lines.push('🧠 <b>ALPHAOS AI TERMINAL</b>');
  lines.push(divider());
  lines.push('');

  lines.push('🟢 <b>System</b>');
  lines.push(`Scanner: <b>${stats.scannerStatus}</b>`);
  lines.push(`Chain: <b>${stats.chain}</b>`);
  lines.push(`Version: <b>${stats.version}</b>`);
  lines.push('');

  lines.push(divider());
  lines.push('📈 <b>Today</b>');
  lines.push(`Alerts: <b>${stats.alertsToday}</b>`);
  lines.push(`BUY Signals: <b>${stats.buysToday}</b>`);
  lines.push('');

  lines.push(divider());
  lines.push('📚 <b>Alpha Memory</b>');
  lines.push(`Tracked Tokens: <b>${stats.tokensTracked}</b>`);
  lines.push(`Timeline Events: <b>${stats.timelineEvents}</b>`);
  lines.push('');

  lines.push(divider());
  lines.push('⚡ <b>API Health</b>');
  lines.push(
    `${apiIcon(stats.apiStatus.dexScreener)} DexScreener: <b>${stats.apiStatus.dexScreener}</b>`
  );
  lines.push(
    `${apiIcon(stats.apiStatus.helius)} Helius: <b>${stats.apiStatus.helius}</b>`
  );
  lines.push(
    `${apiIcon(stats.apiStatus.bitquery)} Bitquery: <b>${stats.apiStatus.bitquery}</b>`
  );
  lines.push(
    `${apiIcon(stats.apiStatus.pumpfun)} Pump.fun: <b>${stats.apiStatus.pumpfun}</b>`
  );
  lines.push('');

  lines.push(divider());
  lines.push('🚀 <b>Latest BUY</b>');

  if (stats.latestBuy) {
    lines.push(`Token: <b>${stats.latestBuy.symbol}</b>`);
    lines.push(`Mint: <code>${shortToken(stats.latestBuy.token)}</code>`);
    lines.push(`Score: <b>${stats.latestBuy.score ?? 'Tracking'}/100</b>`);
    lines.push(`Market Cap: <b>${fmtUsd(stats.latestBuy.marketCap)}</b>`);
  } else {
    lines.push('No BUY signal recorded today.');
  }

  lines.push('');
  lines.push(divider());
  lines.push('Commands');
  lines.push('/terminal');
  lines.push('/research');
  lines.push('/memory');
  lines.push('/stats');

  return lines.join('\n');
}