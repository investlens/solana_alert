import { buildAlphaAlert, compactAddress } from './alphaAlert/index.js';

function formatSol(amountSol?: number | null): string | null {
  if (amountSol == null || !Number.isFinite(amountSol) || amountSol < 0.001) return null;
  return `${amountSol.toFixed(3)} SOL`;
}

function tokenIdentity(args: { tokenName?: string | null; tokenMint?: string | null }) {
  return {
    symbol: args.tokenName?.trim() || compactAddress(args.tokenMint, 6, 5),
    address: args.tokenMint ?? null,
  };
}

export function buildPrivateWalletBuyMessage(args: {
  wallet: string;
  tokenName?: string | null;
  tokenMint?: string | null;
  marketCap?: string | null;
  amountSol?: number | null;
  chartUrl?: string | null;
  buyUrl?: string | null;
}): string {
  const token = tokenIdentity(args);
  return buildAlphaAlert({
    title: 'SMART WALLET RADAR · ENTRY',
    subtitle: 'A watched wallet opened a position',
    tone: 'POSITIVE',
    symbol: token.symbol,
    address: token.address,
    risk: 'REVIEW REQUIRED',
    status: 'EARLY ACTIVITY DETECTED',
    sections: [
      {
        title: 'POSITION SNAPSHOT',
        icon: '📊',
        metrics: [
          { label: 'Wallet', value: compactAddress(args.wallet, 5, 4) },
          { label: 'Market Cap', value: args.marketCap || 'Enrichment pending' },
          { label: 'Position Size', value: formatSol(args.amountSol) || 'Tracking' },
        ],
      },
      {
        title: 'WHY IT MATTERS',
        icon: '🔎',
        items: [
          '✅ Watched-wallet entry detected',
          '✅ Activity recorded in Alpha Memory',
          '✅ Outcome monitoring activated',
        ],
      },
    ],
    verdictTitle: 'WORTH INVESTIGATING',
    verdict: 'Review market structure, wallet history and holder risk before taking action.',
    tracking: 'CONTINUOUS TRACKING ACTIVE',
  });
}

export function buildPrivateWalletSellMessage(args: {
  wallet: string;
  tokenName?: string | null;
  tokenMint?: string | null;
  marketCap?: string | null;
  amountSol?: number | null;
  chartUrl?: string | null;
}): string {
  const token = tokenIdentity(args);
  return buildAlphaAlert({
    title: 'SMART WALLET RADAR · EXIT',
    subtitle: 'A watched wallet reduced its position',
    tone: 'RISK',
    symbol: token.symbol,
    address: token.address,
    risk: 'SELL-SIDE ACTIVITY',
    status: 'POSITION REDUCED',
    sections: [
      {
        title: 'POSITION UPDATE',
        icon: '📤',
        metrics: [
          { label: 'Wallet', value: compactAddress(args.wallet, 5, 4) },
          { label: 'Market Cap', value: args.marketCap || 'Enrichment pending' },
          { label: 'Estimated Value', value: formatSol(args.amountSol) || 'Tracking' },
        ],
      },
      {
        title: 'WHAT CHANGED',
        icon: '🔎',
        items: [
          '⚠️ Exit or reduction detected',
          '✅ Event recorded in Alpha Memory',
          '✅ Token remains under outcome monitoring',
        ],
      },
    ],
    verdictTitle: 'RISK HAS INCREASED',
    verdict: 'Review liquidity and broader holder behaviour before interpreting this wallet move.',
    tracking: 'OUTCOME MONITORING ACTIVE',
  });
}

export function buildPrivateWalletLaunchMessage(args: {
  wallet: string;
  tokenName?: string | null;
  tokenMint?: string | null;
  chartUrl?: string | null;
  buyUrl?: string | null;
}): string {
  const token = tokenIdentity(args);
  return buildAlphaAlert({
    title: 'CREATOR & WALLET RADAR · LAUNCH',
    subtitle: 'A watched wallet launched a fresh token',
    tone: 'PREMIUM',
    symbol: token.symbol,
    address: token.address,
    risk: 'ELEVATED',
    status: 'FRESH LAUNCH DETECTED',
    sections: [
      {
        title: 'LAUNCH IDENTITY',
        icon: '🚀',
        metrics: [{ label: 'Wallet', value: compactAddress(args.wallet, 5, 4) }],
      },
      {
        title: 'WHY IT MATTERS',
        icon: '🔎',
        items: [
          '✅ Contract captured during the early lifecycle',
          '✅ Creator event added to Alpha Memory',
          '⚠️ Liquidity and holder evidence may still be incomplete',
        ],
      },
    ],
    verdictTitle: 'EARLY-STAGE INVESTIGATION',
    verdict: 'Fresh launches carry elevated creator, liquidity and holder risk. Wait for evidence before acting.',
    tracking: 'CREATOR TRACKING ACTIVE',
  });
}
