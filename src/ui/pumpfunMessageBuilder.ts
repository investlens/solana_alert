import type { CreatorProfile } from '../profiles/creatorProfile.js';

function divider() {
  return '━━━━━━━━━━━━━━━━━━━━━━';
}

function shortMint(mint: string) {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function shortWallet(wallet?: string | null) {
  if (!wallet) return 'n/a';
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function fmtPct(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(1)}%`;
}

function fmtUsd(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'n/a';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getVerdict(score?: number | null) {
  if (score == null || !Number.isFinite(score)) return '⚪ Insufficient Evidence';
  if (score >= 90) return '🟢 High Conviction Launch';
  if (score >= 80) return '🟢 Strong Early Opportunity';
  if (score >= 75) return '🟡 Worth Watching';
  if (score >= 60) return '🟠 High Risk Watch';
  return '🔴 Avoid';
}

function convictionBar(score?: number | null) {
  const value = score == null || !Number.isFinite(score) ? 50 : Math.max(0, Math.min(100, score));
  const filled = Math.round(value / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(value)}%`;
}

export function buildPumpfunEarlyMessage(args: {
  symbol?: string | null;
  name?: string | null;
  mint: string;
  creator?: string | null;
  creatorProfile?: CreatorProfile | null;
  progressPct?: number | null;
  buyCount?: number | null;
  sellCount?: number | null;
  volumeUsd?: number | null;
  marketCapUsd?: number | null;
  launchScore?: number | null;
  isMutable?: boolean | null;
}) {
  const lines: string[] = [];
  const creator = args.creatorProfile;

  lines.push('🧠 <b>AlphaOS Launch Brief</b>');
  lines.push('');
  lines.push(`<b>${escapeHtml(args.symbol || 'Unknown')}</b> • <code>${shortMint(args.mint)}</code>`);

  if (args.name) {
    lines.push(`<b>Name</b>: ${escapeHtml(args.name)}`);
  }

  lines.push('');
  lines.push(`<b>Verdict</b>: ${getVerdict(args.launchScore)}`);
  lines.push(`<b>AI Conviction</b>: ${convictionBar(args.launchScore)}`);
  lines.push('');
  lines.push(divider());
  lines.push('');

  lines.push('<b>Executive Summary</b>');

  if (creator?.hasData) {
    lines.push(
      `AlphaOS detected a fresh Pump.fun launch with creator history available. Creator rating is ${escapeHtml(
        creator.rating
      )} with a trust score of ${creator.trustScore}/100.`
    );
  } else {
    lines.push(
      'AlphaOS detected a fresh Pump.fun launch. Creator history is limited or not yet available, so this should be treated as early-stage research.'
    );
  }

  lines.push('');
  lines.push('<b>Quick Checklist</b>');
  lines.push(`${(args.launchScore ?? 0) >= 75 ? '✅' : '⚠️'} Launch quality: ${args.launchScore ?? 'n/a'}/100`);
  lines.push(`${args.isMutable === false ? '✅' : '⚠️'} Mutable metadata: ${args.isMutable === false ? 'No' : args.isMutable === true ? 'Yes' : 'Unknown'}`);
  lines.push(`${creator?.rating === 'PROVEN' || creator?.rating === 'PROMISING' ? '✅' : '⚠️'} Creator history: ${creator?.rating ?? 'UNKNOWN'}`);
  lines.push(`${(args.buyCount ?? 0) > (args.sellCount ?? 0) ? '✅' : '⚠️'} Buy pressure: ${args.buyCount ?? 0}/${args.sellCount ?? 0}`);
  lines.push('');

  lines.push('<b>Creator Intelligence</b>');
  lines.push(`• Wallet: <code>${shortWallet(args.creator)}</code>`);
  lines.push(`• Rating: <b>${creator?.rating ?? 'UNKNOWN'}</b>`);
  lines.push(`• Trust Score: <b>${creator?.trustScore ?? 50}/100</b>`);
  lines.push(`• Launches: <b>${creator?.launches ?? 0}</b>`);
  lines.push(`• Successful: <b>${creator?.successfulLaunches ?? 0}</b>`);
  lines.push(`• Highest MC: <b>${fmtUsd(creator?.highestMarketCap ?? 0)}</b>`);
  lines.push('');

  lines.push('<b>Launch Snapshot</b>');

  if (args.marketCapUsd != null) {
    lines.push(`• Market Cap: <b>${fmtUsd(args.marketCapUsd)}</b>`);
  }

  if (args.volumeUsd != null) {
    lines.push(`• Volume: <b>${fmtUsd(args.volumeUsd)}</b>`);
  }

  if (args.progressPct != null) {
    lines.push(`• Curve Progress: <b>${fmtPct(args.progressPct)}</b>`);
  }

  if (args.buyCount != null || args.sellCount != null) {
    lines.push(`• Buys/Sells: <b>${args.buyCount ?? 0}/${args.sellCount ?? 0}</b>`);
  }

  lines.push('');
  lines.push('<b>Risks</b>');
  lines.push('• Very early and volatile');
  lines.push('• Liquidity may not exist yet before migration');
  lines.push('• Creator history may be incomplete');
  lines.push('');
  lines.push('<b>Suggested Action</b>: Investigate Further');
  lines.push('');
  lines.push('Open AlphaOS Terminal for full investigation.');

  return lines.join('\n');
}