import { compactAlphaAddress, renderAlphaNotification } from './alphaNotification.js';

function formatSol(value?: number | null) {
  return value == null || !Number.isFinite(value) || value < 0.001 ? 'Data unavailable' : `${value.toFixed(3)} SOL`;
}

type WalletArgs = {
  wallet: string; tokenName?: string | null; tokenMint?: string | null;
  marketCap?: string | null; amountSol?: number | null; chartUrl?: string | null; buyUrl?: string | null;
};

function identity(args: WalletArgs) {
  return args.tokenName?.trim() || compactAlphaAddress(args.tokenMint) || 'Unknown token';
}

export function buildPrivateWalletBuyMessage(args: WalletArgs): string {
  return renderAlphaNotification({
    category: 'wallet', severity: 'positive', state: 'WALLET_BUY', symbol: identity(args), address: args.tokenMint,
    risk: 'REVIEW', metrics: [
      { label: 'Wallet', value: compactAlphaAddress(args.wallet, 5, 4) },
      { label: 'Market cap', value: args.marketCap || 'Data unavailable' },
      { label: 'Value', value: formatSol(args.amountSol) },
    ], reason: 'Watched wallet opened a position.', recommendedAction: 'Review live market and wallet evidence.',
  });
}

export function buildPrivateWalletSellMessage(args: WalletArgs): string {
  return renderAlphaNotification({
    category: 'wallet', severity: 'warning', state: 'WALLET_SELL', symbol: identity(args), address: args.tokenMint,
    risk: 'REVIEW', metrics: [
      { label: 'Wallet', value: compactAlphaAddress(args.wallet, 5, 4) },
      { label: 'Market cap', value: args.marketCap || 'Data unavailable' },
      { label: 'Value', value: formatSol(args.amountSol) },
    ], reason: 'Watched wallet reduced a position.', recommendedAction: 'Review liquidity and broader holder behavior.',
  });
}

export function buildPrivateWalletLaunchMessage(args: Omit<WalletArgs, 'marketCap' | 'amountSol'>): string {
  return renderAlphaNotification({
    category: 'creator', severity: 'watch', state: 'WALLET_LAUNCH', symbol: identity(args), address: args.tokenMint,
    risk: 'ELEVATED', metrics: [{ label: 'Wallet', value: compactAlphaAddress(args.wallet, 5, 4) }],
    reason: 'Watched wallet launched a fresh token.', recommendedAction: 'Wait for liquidity and holder evidence before acting.',
  });
}
