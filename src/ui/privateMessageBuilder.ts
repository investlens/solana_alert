function shortWallet(wallet: string) {
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function divider() {
  return '━━━━━━━━━━━━━━━';
}

export function buildPrivateWalletBuyMessage(args: {
  wallet: string;
  tokenName?: string | null;
  tokenMint?: string | null;
  marketCap?: string | null;
  amountSol?: number | null;
  chartUrl?: string | null;
  buyUrl?: string | null;
}) {
  const lines: string[] = [];

  lines.push('🕵️ <b>WALLET BUY</b>');
  lines.push(divider());
  lines.push(`Wallet  <code>${shortWallet(args.wallet)}</code>`);

  if (args.tokenName) {
    lines.push(`Token  <b>${args.tokenName}</b>`);
  }

  if (args.marketCap) {
    lines.push(`MCap  <b>${args.marketCap}</b>`);
  }

  if (args.amountSol != null && args.amountSol >= 0.001) {
    lines.push(`Spent  <b>${args.amountSol.toFixed(3)} SOL</b>`);
  }

  lines.push('');
  lines.push('🟢 Early wallet accumulation detected');

  if (args.chartUrl) {
    lines.push('');
    lines.push(`📈 ${args.chartUrl}`);
  }

  if (args.buyUrl) {
    lines.push(`🟢 ${args.buyUrl}`);
  }

  return lines.join('\n');
}

export function buildPrivateWalletSellMessage(args: {
  wallet: string;
  tokenName?: string | null;
  tokenMint?: string | null;
  marketCap?: string | null;
  amountSol?: number | null;
  chartUrl?: string | null;
}) {
  const lines: string[] = [];

  lines.push('📤 <b>WALLET SELL</b>');
  lines.push(divider());
  lines.push(`Wallet  <code>${shortWallet(args.wallet)}</code>`);

  if (args.tokenName) {
    lines.push(`Token  <b>${args.tokenName}</b>`);
  }

  if (args.marketCap) {
    lines.push(`MCap  <b>${args.marketCap}</b>`);
  }

  if (args.amountSol != null && args.amountSol >= 0.001) {
    lines.push(`Received  <b>${args.amountSol.toFixed(3)} SOL</b>`);
  }

  lines.push('');
  lines.push('⚠️ Wallet reduced position');

  if (args.chartUrl) {
    lines.push('');
    lines.push(`📈 ${args.chartUrl}`);
  }

  return lines.join('\n');
}

export function buildPrivateWalletLaunchMessage(args: {
  wallet: string;
  tokenName?: string | null;
  tokenMint?: string | null;
  chartUrl?: string | null;
  buyUrl?: string | null;
}) {
  const lines: string[] = [];

  lines.push('🚨 <b>WATCHED WALLET LAUNCH</b>');
  lines.push(divider());
  lines.push(`Wallet  <code>${shortWallet(args.wallet)}</code>`);

  if (args.tokenName) {
    lines.push(`Token  <b>${args.tokenName}</b>`);
  }

  lines.push('');
  lines.push('🔥 Watched wallet launched a fresh token');

  if (args.chartUrl) {
    lines.push('');
    lines.push(`📈 ${args.chartUrl}`);
  }

  if (args.buyUrl) {
    lines.push(`🟢 ${args.buyUrl}`);
  }

  return lines.join('\n');
}