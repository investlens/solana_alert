import type {
  AlphaInvestigation,
  AlphaSuggestedAction,
  AlphaVerdict,
  ChecklistStatus,
} from '../types/alphaInvestigation.js';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function money(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 'N/A';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function verdictLabel(verdict: AlphaVerdict) {
  if (verdict === 'STRONG_OPPORTUNITY') return '🟢 Strong Opportunity';
  if (verdict === 'WORTH_WATCHING') return '🟡 Worth Watching';
  if (verdict === 'HIGH_RISK') return '🟠 High Risk';
  if (verdict === 'AVOID') return '🔴 Avoid';
  return '⚪ Insufficient Evidence';
}

function actionLabel(action: AlphaSuggestedAction) {
  if (action === 'INVESTIGATE_FURTHER') return 'Investigate Further';
  if (action === 'MONITOR_CLOSELY') return 'Monitor Closely';
  if (action === 'WAIT_FOR_CONFIRMATION') return 'Wait For Confirmation';
  if (action === 'HIGH_RISK_SPECULATION') return 'High Risk Speculation';
  return 'Avoid';
}

function statusIcon(status: ChecklistStatus) {
  if (status === 'PASS') return '✅';
  if (status === 'WARN') return '⚠️';
  if (status === 'FAIL') return '❌';
  return '❔';
}

function firstLines(items: string[], limit: number) {
  return items.slice(0, limit).map((item) => `• ${escapeHtml(item)}`);
}

export function buildAlphaInvestigationTelegramMessage(
  investigation: AlphaInvestigation
): string {
  const lines: string[] = [];

  lines.push('🧠 <b>AlphaOS Research Alert</b>');
  lines.push('');
  lines.push(`<b>${escapeHtml(investigation.symbol)}</b> — ${escapeHtml(investigation.name)}`);
  lines.push(`<code>${escapeHtml(investigation.tokenAddress)}</code>`);
  lines.push('');
  lines.push(`<b>Verdict</b>: ${verdictLabel(investigation.verdict)}`);
  lines.push(`<b>Confidence</b>: ${investigation.confidence}%`);
  lines.push(`<b>Suggested Action</b>: ${actionLabel(investigation.suggestedAction)}`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('<b>Executive Summary</b>');
  lines.push(escapeHtml(investigation.executiveSummary));
  lines.push('');
  lines.push('<b>Investment Checklist</b>');

  for (const item of investigation.checklist.slice(0, 6)) {
    lines.push(`${statusIcon(item.status)} <b>${escapeHtml(item.label)}</b>: ${escapeHtml(item.detail)}`);
  }

  lines.push('');

lines.push('');
lines.push('<b>Creator Intelligence</b>');
lines.push(`• Rating: <b>${escapeHtml(investigation.creator.rating)}</b>`);
lines.push(`• Trust Score: <b>${investigation.creator.trustScore}/100</b>`);
lines.push(`• Launches: <b>${investigation.creator.launches}</b>`);
lines.push(`• Successful: <b>${investigation.creator.successfulLaunches}</b>`);
lines.push(`• Highest MC: <b>${money(investigation.creator.highestMarketCap)}</b>`);
lines.push(`• Summary: ${escapeHtml(investigation.creator.summary)}`);
lines.push('');

  lines.push('<b>Market Snapshot</b>');
  lines.push(`• Market Cap: <b>${money(investigation.market.marketCap)}</b>`);
  lines.push(`• FDV: <b>${money(investigation.market.fdv)}</b>`);
  lines.push(`• Liquidity: <b>${money(investigation.market.liquidityUsd)}</b>`);
  lines.push(`• 5m Volume: <b>${money(investigation.market.volume5m)}</b>`);
  lines.push(`• Buys/Sells: <b>${investigation.market.buys5m}/${investigation.market.sells5m}</b>`);
  lines.push(`• Age: <b>${Math.round(investigation.market.ageMin)}m</b>`);
  lines.push('');

  const evidence = firstLines(investigation.evidence, 4);
  if (evidence.length > 0) {
    lines.push('<b>Evidence</b>');
    lines.push(...evidence);
    lines.push('');
  }

  const risks = firstLines([...investigation.warnings, ...investigation.risks], 4);
  if (risks.length > 0) {
    lines.push('<b>Risks / Warnings</b>');
    lines.push(...risks);
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('Open AlphaOS Terminal for the full investigation.');

  if (investigation.url) {
    lines.push(`Chart: ${escapeHtml(investigation.url)}`);
  }

  return lines.join('\n');
}