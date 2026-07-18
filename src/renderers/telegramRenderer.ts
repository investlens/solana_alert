import type { Investigation } from '../models/investigation.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }

  return `$${value.toFixed(2)}`;
}

function statusDisplay(status: Investigation['signal']['status']): string 
{
  if (status === 'LIVE') return '🟢 LIVE';
  if (status === 'MONITORING') return '🟡 MONITORING';
  if (status === 'INVALIDATED') return '🔴 INVALIDATED';
  return '⚫ ARCHIVED';
}

function signalIcon(tier: Investigation['signal']['tier']): string {
  if (tier === 'P0') return '🚀';
  if (tier === 'P1') return '🔥';
  return '🟡';
}

function creatorDisplay(investigation: Investigation): string[] {
  const creator = investigation.creator;

  if (!creator.wallet) {
    return [
      '👤 <b>Creator</b>',
      'Status: <b>SCANNING</b>',
      'AlphaOS is collecting creator history.',
    ];
  }

  const lines = [
    '👤 <b>Creator</b>',
    `Status: <b>${escapeHtml(creator.status)}</b>`,
    `Score: <b>${creator.score}/100</b>`,
    `Launches: <b>${creator.launches}</b>`,
  ];

  if (creator.bestMarketCap > 0) {
    lines.push(`Best MC: <b>${fmtUsd(creator.bestMarketCap)}</b>`);
  }

  return lines;
}

function riskDisplay(
  hasData: boolean,
  level: string,
  score: number
): string {
  if (!hasData) return 'SCANNING';
  return `${escapeHtml(level)} (${score}/100)`;
}

function buildAiSummary(investigation: Investigation): string[] {
  const reasons =
    investigation.ai.reasons.length > 0
      ? investigation.ai.reasons
      : ['AlphaOS is monitoring confirmation signals'];

  return reasons.slice(0, 3).map((reason) => {
    return `• ${escapeHtml(reason)}`;
  });
}

export function renderTelegramInvestigation(
  investigation: Investigation
): string {
  const historicalEdge =
    investigation.ai.historicalEdge >= 0
      ? `+${investigation.ai.historicalEdge}`
      : String(investigation.ai.historicalEdge);

  return [
    '🧠 <b>ALPHAOS AI</b>',
    '',
    `${signalIcon(investigation.signal.tier)} <b>${escapeHtml(
      investigation.signal.title
    )}</b>`,
    `${statusDisplay(investigation.signal.status)} • 
${investigation.signal.ageMinutes}m old`,
    '━━━━━━━━━━━━━━━━━━',
    '',
    `🪙 <b>${escapeHtml(investigation.token.symbol)}</b>`,
    `<code>${escapeHtml(investigation.token.shortAddress)}</code>`,
    '',
    `AI Score: <b>${investigation.ai.finalScore}/100</b>`,
    `Confidence: <b>${investigation.ai.confidence}%</b>`,
    `Risk: <b>${escapeHtml(investigation.ai.riskLevel)}</b>`,
    `Timing: <b>${escapeHtml(investigation.signal.timingLabel)}</b>`,
    '',
    '📊 <b>Market Snapshot</b>',
    `MC: <b>${fmtUsd(investigation.market.marketCap)}</b>`,
    `Liquidity: <b>${fmtUsd(investigation.market.liquidity)}</b>`,
    `Volume 5m: <b>${fmtUsd(investigation.market.volume5m)}</b>`,
    `Buy Ratio: <b>${investigation.orderflow.buyRatio.toFixed(2)}x</b>`,
    `Orderflow: <b>${investigation.orderflow.buyerPercentage}% 
buyers</b>`,
    '',
    ...creatorDisplay(investigation),
    '',
    '🛡 <b>Risk Intelligence</b>',
    `Holder: <b>${riskDisplay(
      investigation.risk.holder.hasData,
      investigation.risk.holder.level,
      investigation.risk.holder.score
    )}</b>`,
    `Bundle: <b>${riskDisplay(
      investigation.risk.bundle.hasData,
      investigation.risk.bundle.level,
      investigation.risk.bundle.score
    )}</b>`,
    `Known Buyers: <b>${investigation.risk.knownBuyers}</b>`,
    '',
    '🤖 <b>AlphaOS Verdict</b>',
    `Decision: <b>${escapeHtml(investigation.ai.verdict)}</b>`,
    `Historical Edge: <b>${historicalEdge}</b>`,
    ...buildAiSummary(investigation),
    '',
    '━━━━━━━━━━━━━━━━━━',
    '📚 <b>Continuous Tracking Active</b>',
    '5m • 15m • 30m • 1h • 6h • 24h',
    '',
    '<i>Open the AI Report for the complete investigation.</i>',
  ].join('\n');
}
