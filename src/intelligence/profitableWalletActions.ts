import { addTrackedWallet, getRecentTrackedWalletActivity } from '../services/trackedWalletService.js';

const TRACK_PREFIX = 'profitable_wallet_track:';
const HISTORY_PREFIX = 'profitable_wallet_history:';

function callbackWallet(data: string, prefix: string) {
  if (!data.startsWith(prefix)) return null;
  const wallet = data.slice(prefix.length).trim();
  return /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet : null;
}

/**
 * Reuses AlphaOS' existing per-user Robinhood watchlist. No new table,
 * scanner, cursor model, or duplicate chain monitoring is introduced.
 */
export async function handleProfitableWalletTrackAction(args: {
  telegramId: string;
  callbackData: string;
}) {
  const wallet = callbackWallet(args.callbackData, TRACK_PREFIX);
  if (!wallet) return { handled: false as const };

  await addTrackedWallet({
    telegramId: args.telegramId,
    walletAddress: wallet,
    chain: 'robinhood',
    label: 'AlphaOS Profitable Wallet',
  });

  return { handled: true as const, wallet };
}

/**
 * History is deliberately bounded by the existing service (max 25 rows).
 */
export async function handleProfitableWalletHistoryAction(args: {
  telegramId: string;
  callbackData: string;
  limit?: number;
}) {
  const wallet = callbackWallet(args.callbackData, HISTORY_PREFIX);
  if (!wallet) return { handled: false as const };

  const history = await getRecentTrackedWalletActivity(
    wallet,
    Math.max(1, Math.min(10, args.limit ?? 5)),
    args.telegramId,
    'robinhood',
  );

  return { handled: true as const, wallet, history };
}
