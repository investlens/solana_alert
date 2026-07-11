import type {
  AlphaInvestigation,
  AlphaSuggestedAction,
  AlphaVerdict,
  ChecklistStatus,
} from '../types/alphaInvestigation.js';

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function divider() {
  return '━━━━━━━━━━━━━━━━━━';
}

function money(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 'Tracking';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function verdictLabel(verdict: AlphaVerdict) {
  if (verdict === 'STRONG_OPPORTUNITY') return '🟢 STRONG OPPORTUNITY';
  if (verdict === 'WORTH_WATCHING') return '🟡 WORTH WATCHING';
  if (verdict === 'HIGH_RISK') return '🟠 HIGH RISK';
  if (verdict === 'AVOID') return '🔴 AVOID';
  return '⚪ INSUFFICIENT EVIDENCE';
}

function actionLabel(action: AlphaSuggestedAction) {
  if (action === 'INVESTIGATE_FURTHER') return 'Investigate further';
  if (action === 'MONITOR_CLOSELY') return 'Monitor closely';
  if (action === 'WAIT_FOR_CONFIRMATION') return 'Wait for confirmation';
  if (action === 'HIGH_RISK_SPECULATION') return 'High-risk speculation';
  return 'Avoid';
}

function statusIcon(status: ChecklistStatus) {
  if (status === 'PASS') return '✅';
  if (status === 'WARN') return '⚠️';
  if (status === 'FAIL') return '❌';
  return '❔';
}

function shortToken(token: string) {
  return token.length > 14 ? `${token.slice(0, 6)}...${token.slice(-6)}` : token;
}

function confidenceBar(confidence: number) {
  const units = Math.max(0, Math.min(10, Math.floor(confidence / 10)));
  return '█'.repeat(units) + '░'.repeat(10 - units);
}

export function buildAlphaInvestigationTelegramMessage(
  investigation: AlphaInvestigation
): string {
  const lines: string[] = [];

  const topEvidence = investigation.evidence.slice(0, 3);
  const topRisks = [...investigation.warnings, ...investigation.risks].slice(0, 3);

  lines.push('🧠 <b>ALPHAOS AI</b>');
  lines.push('🔎 <b>RESEARCH INVESTIGATION</b>');
  lines.push(divider());
  lines.push('');
  lines.push(`🪙 <b>${escapeHtml(investigation.symbol)}</b>`);
  lines.push(`<i>${escapeHtml(investigation.name)}</i>`);
  lines.push(`<code>${escapeHtml(shortToken(investigation.tokenAddress))}</code>`);
  lines.push('');
  lines.push(`Verdict: <b>${verdictLabel(investigation.verdict)}</b>`);
  lines.push(`AI Confidence: <b>${investigation.confidence}/100</b>`);
  lines.push(`Confidence: <b>${confidenceBar(investigation.confidence)}</b>`);
  lines.push(`Action: <b>${actionLabel(investigation.suggestedAction)}</b>`);
  lines.push('');
  lines.push(divider());

  lines.push('📊 <b>Market Structure</b>');
  lines.push(`Market Cap: <b>${money(investigation.market.marketCap)}</b>`);
  lines.push(`FDV: <b>${money(investigation.market.fdv)}</b>`);
  lines.push(`Liquidity: <b>${money(investigation.market.liquidityUsd)}</b>`);
  lines.push(`5m Volume: <b>${money(investigation.market.volume5m)}</b>`);
  lines.push(`Buys/Sells: <b>${investigation.market.buys5m}/${investigation.market.sells5m}</b>`);
  lines.push(`Age: <b>${Math.round(investigation.market.ageMin)}m</b>`);
  lines.push('');

  lines.push('👤 <b>Creator Intelligence</b>');
  lines.push(`Rating: <b>${escapeHtml(investigation.creator.rating)}</b>`);
  lines.push(`Trust Score: <b>${investigation.creator.trustScore}/100</b>`);
  lines.push(`Launches: <b>${investigation.creator.launches}</b>`);
  lines.push(`Successful: <b>${investigation.creator.successfulLaunches}</b>`);
  lines.push(`Highest MC: <b>${money(investigation.creator.highestMarketCap)}</b>`);
  lines.push(`Verdict: <b>${escapeHtml(investigation.creator.summary)}</b>`);
  lines.push('');

  lines.push('🧪 <b>Checklist</b>');
  for (const item of investigation.checklist.slice(0, 5)) {
    lines.push(`${statusIcon(item.status)} <b>${escapeHtml(item.label)}</b>: ${escapeHtml(item.detail)}`);
  }
  lines.push('');

  lines.push('🤖 <b>AlphaOS Verdict</b>');
  lines.push(escapeHtml(investigation.executiveSummary));
  lines.push('');

  if (topEvidence.length) {
    lines.push('<b>Why AlphaOS is watching</b>');
    lines.push(...topEvidence.map((x) => `✅ ${escapeHtml(x)}`));
    lines.push('');
  }

  if (topRisks.length) {
    lines.push('<b>Risks / Watch</b>');
    lines.push(...topRisks.map((x) => `⚠️ ${escapeHtml(x)}`));
    lines.push('');
  }

  lines.push(divider());
  lines.push('📚 <b>Alpha Memory</b>');
  lines.push('This token is tracked in AlphaOS timeline.');
  lines.push('Future updates will improve scoring.');

  if (investigation.url) {
    lines.push('');
    lines.push(`Chart: ${escapeHtml(investigation.url)}`);
  }

  return lines.join('\n');
}