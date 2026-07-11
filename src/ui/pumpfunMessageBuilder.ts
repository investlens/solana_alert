import type { CreatorProfile } from '../profiles/creatorProfile.js';

function divider() {
  return '━━━━━━━━━━━━━━━━━━';
}

function shortMint(mint: string) {
  return `${mint.slice(0, 6)}...${mint.slice(-6)}`;
}

function shortWallet(wallet?: string | null) {
  if (!wallet) return 'Tracking';
  return `${wallet.slice(0, 6)}...${wallet.slice(-6)}`;
}

function fmtPct(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return 'Tracking';
  return `${value.toFixed(1)}%`;
}

function fmtUsd(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'Tracking';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getVerdict(score?: number | null) {
  if (score == null || !Number.isFinite(score)) return '⚪ TRACKING';
  if (score >= 90) return '🚀 HIGH CONVICTION LAUNCH';
  if (score >= 80) return '🟢 STRONG EARLY LAUNCH';
  if (score >= 75) return '🟡 WATCHLIST LAUNCH';
  if (score >= 60) return '🟠 HIGH RISK WATCH';
  return '🔴 AVOID';
}

function convictionBar(score?: number | null) {
  const value = score == null || !Number.isFinite(score) ? 50 : Math.max(0, Math.min(100, score));
  const filled = Math.floor(value / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
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
  const creator = args.creatorProfile;
  const symbol = args.symbol || 'Unknown';
  const name = args.name || symbol;
  const buys = args.buyCount ?? 0;
  const sells = args.sellCount ?? 0;

  const lines: string[] = [];

  lines.push('🧠 <b>ALPHAOS AI</b>');
  lines.push('🧪 <b>PUMP.FUN LAUNCH BRIEF</b>');
  lines.push(divider());
  lines.push('');
  lines.push(`🪙 <b>${escapeHtml(symbol)}</b>`);
  lines.push(`<i>${escapeHtml(name)}</i>`);
  lines.push(`<code>${shortMint(args.mint)}</code>`);
  lines.push('');
  lines.push(`Verdict: <b>${getVerdict(args.launchScore)}</b>`);
  lines.push(`Launch Score: <b>${args.launchScore ?? 'Tracking'}/100</b>`);
  lines.push(`AI Conviction: <b>${convictionBar(args.launchScore)}</b>`);
  lines.push('');
  lines.push(divider());

  lines.push('📊 <b>Launch Snapshot</b>');
  lines.push(`Market Cap: <b>${fmtUsd(args.marketCapUsd)}</b>`);
  lines.push(`Volume: <b>${fmtUsd(args.volumeUsd)}</b>`);
  lines.push(`Curve Progress: <b>${fmtPct(args.progressPct)}</b>`);
  lines.push(`Buys/Sells: <b>${buys}/${sells}</b>`);
  lines.push(`Mutable Metadata: <b>${args.isMutable === false ? 'No' : args.isMutable === true ? 'Yes' : 'Tracking'}</b>`);
  lines.push('');

  lines.push('👤 <b>Creator Intelligence</b>');
  lines.push(`Wallet: <code>${shortWallet(args.creator)}</code>`);
  lines.push(`Rating: <b>${creator?.rating ?? 'UNKNOWN'}</b>`);
  lines.push(`Trust Score: <b>${creator?.trustScore ?? 50}/100</b>`);
  lines.push(`Launches: <b>${creator?.launches ?? 0}</b>`);
  lines.push(`Successful: <b>${creator?.successfulLaunches ?? 0}</b>`);
  lines.push(`Highest MC: <b>${fmtUsd(creator?.highestMarketCap ?? 0)}</b>`);
  lines.push('');

  lines.push('🤖 <b>AlphaOS Verdict</b>');

  if (creator?.hasData) {
    lines.push(
      `Creator history detected. Rating is <b>${escapeHtml(creator.rating)}</b> with trust score <b>${creator.trustScore}/100</b>.`
    );
  } else {
    lines.push('Fresh launch detected. Creator history is still being learned by AlphaOS.');
  }

  lines.push('');

  lines.push('<b>Why AlphaOS is watching</b>');
  lines.push(`${(args.launchScore ?? 0) >= 75 ? '✅' : '⚠️'} Launch quality: ${args.launchScore ?? 'Tracking'}/100`);
  lines.push(`${args.isMutable === false ? '✅' : '⚠️'} Metadata safety: ${args.isMutable === false ? 'Immutable' : 'Needs monitoring'}`);
  lines.push(`${buys > sells ? '✅' : '⚠️'} Buy pressure: ${buys}/${sells}`);
  lines.push('');

  lines.push('<b>Risks / Watch</b>');
  lines.push('⚠️ Very early and volatile');
  lines.push('⚠️ Liquidity may not exist before migration');
  lines.push('⚠️ Creator profile may be incomplete');
  lines.push('');

  lines.push(divider());
  lines.push('📚 <b>Alpha Memory</b>');
  lines.push('This launch is being tracked.');
  lines.push('Future updates will improve creator scoring.');

  return lines.join('\n');
}