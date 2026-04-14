function shortWallet(wallet: string) {
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
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

  lines.push('🕵️ <b>SMART WALLET BUY</b>');
  lines.push(`Wallet: <code>${shortWallet(args.wallet)}</code>`);
  if (args.tokenName) lines.push(`Token: <b>${args.tokenName}</b>`);
  if (args.marketCap) lines.push(`MCap: <b>${args.marketCap}</b>`);
  if (args.amountSol != null) lines.push(`Spent: <b>${args.amountSol.toFixed(4)} SOL</b>`);
  if (args.chartUrl) lines.push(`📈 ${args.chartUrl}`);
  if (args.buyUrl) lines.push(`🟢 ${args.buyUrl}`);

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
  lines.push(`Wallet: <code>${shortWallet(args.wallet)}</code>`);
  if (args.tokenName) lines.push(`Token: <b>${args.tokenName}</b>`);
  if (args.chartUrl) lines.push(`📈 ${args.chartUrl}`);
  if (args.buyUrl) lines.push(`🟢 ${args.buyUrl}`);

  return lines.join('\n');
}