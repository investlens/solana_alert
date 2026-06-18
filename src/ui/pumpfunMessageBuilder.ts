function divider() {
  return '━━━━━━━━━━━━━━━';
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
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `$${Math.round(value).toLocaleString()}`;
}

function getScoreLabel(score?: number | null) {
  if (score == null || !Number.isFinite(score)) return 'WATCH';
  if (score >= 90) return 'ELITE EARLY';
  if (score >= 80) return 'HIGH PRIORITY';
  if (score >= 75) return 'STRONG WATCH';
  return 'WATCH';
}

export function buildPumpfunEarlyMessage(args: {
  symbol?: string | null;
  name?: string | null;
  mint: string;
  creator?: string | null;
  progressPct?: number | null;
  buyCount?: number | null;
  sellCount?: number | null;
  volumeUsd?: number | null;
  marketCapUsd?: number | null;
  launchScore?: number | null;
  isMutable?: boolean | null;
}) {
  const lines: string[] = [];
  const scoreLabel = getScoreLabel(args.launchScore);

  lines.push('🧪 <b>PUMP.FUN EARLY WATCH</b>');
  lines.push(divider());
  lines.push(`<b>${args.symbol || 'Unknown'} • ${shortMint(args.mint)}</b>`);

  if (args.name) {
    lines.push(`<b>Name</b>  ${args.name}`);
  }

  lines.push('');

  lines.push(`<b>Launch Score</b>  ${args.launchScore ?? 'n/a'} (${scoreLabel})`);
  lines.push(`<b>Creator</b>  <code>${shortWallet(args.creator)}</code>`);
  lines.push(`<b>Mutable</b>  ${args.isMutable === false ? 'No' : args.isMutable === true ? 'Yes' : 'n/a'}`);

  lines.push('');

  if (args.marketCapUsd != null) {
    lines.push(`<b>MCap</b>  ${fmtUsd(args.marketCapUsd)}`);
  }

  if (args.volumeUsd != null) {
    lines.push(`<b>Volume</b>  ${fmtUsd(args.volumeUsd)}`);
  }

  if (args.progressPct != null) {
    lines.push(`<b>Curve Progress</b>  ${fmtPct(args.progressPct)}`);
  }

  if (args.buyCount != null || args.sellCount != null) {
    lines.push(`<b>Buys/Sells</b>  ${args.buyCount ?? 0}/${args.sellCount ?? 0}`);
  }

  lines.push('');
  lines.push('<b>Why it passed</b>');

  if ((args.launchScore ?? 0) >= 80) {
    lines.push('• Strong symbol/name quality');
    lines.push('• Better early setup than average');
    lines.push('• Worth immediate attention');
  } else if ((args.launchScore ?? 0) >= 65) {
    lines.push('• Cleared basic junk filters');
    lines.push('• Cleaner launch than most');
    lines.push('• Good watch candidate');
  } else {
    lines.push('• Fresh launch detected');
    lines.push('• Cleared minimum quality filters');
    lines.push('• Early but higher risk');
  }

  lines.push('');
  lines.push('⚠️ Very early and volatile');
  lines.push('📈 Watch before DEX migration');

  return lines.join('\n');
}