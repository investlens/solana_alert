import {
  type ProfitableWalletFeatureMode,
  type ProvenWalletDecision,
  profitableWalletFeatureMode,
} from './provenWalletIntelligence.js';

export type ProfitableWalletAlertModel = {
  wallet: string;
  consecutiveProfitableTrades: number;
  winRate: number;
  averageRealisedRoi: number;
  bestRealisedReturn: number;
  earlyEntryRate?: number | null;
  decision: ProvenWalletDecision;
};

const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

export function buildProfitableWalletDiscoveryAlert(model: ProfitableWalletAlertModel) {
  const wallet = model.wallet.trim();
  const shortWallet = wallet.length > 14
    ? `${wallet.slice(0, 8)}…${wallet.slice(-6)}`
    : wallet;

  return [
    '🧠 PROFITABLE WALLET DISCOVERED',
    '',
    `💼 Wallet: ${shortWallet}`,
    `🔥 Consecutive profitable trades: ${model.consecutiveProfitableTrades}`,
    `📈 Win rate: ${model.winRate.toFixed(1)}%`,
    `💰 Avg realized ROI: ${pct(model.averageRealisedRoi)}`,
    `🚀 Best realized trade: ${pct(model.bestRealisedReturn)}`,
    model.earlyEntryRate == null ? null : `🎯 Early-entry rate: ${model.earlyEntryRate.toFixed(1)}%`,
    `🧠 AlphaOS confidence: ${model.decision.score}/100`,
    '',
    'A profitable-wallet signal is supporting evidence, not an automatic token buy.',
  ].filter(Boolean).join('\n');
}

export function profitableWalletDiscoveryActions(wallet: string) {
  const normalized = wallet.trim().toLowerCase();
  return {
    track: `profitable_wallet_track:${normalized}`,
    history: `profitable_wallet_history:${normalized}`,
  };
}

/**
 * Final delivery guard. A caller must explicitly be in live mode AND the
 * wallet must pass the strict discovery threshold. Observe/off can never send.
 */
export function canDeliverProfitableWalletAlert(
  decision: ProvenWalletDecision,
  mode: ProfitableWalletFeatureMode = profitableWalletFeatureMode(),
) {
  return mode === 'live' && decision.discoveryAlertEligible;
}
