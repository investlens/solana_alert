export { escapeTelegramHtml } from '../ui/escapeHtml.js';
export { detectWalletAddress } from '../services/walletAddress.js';
import { requireWalletAddress } from '../services/walletAddress.js';

export function normalizeSolanaPublicAddress(value: string): string {
  const detected = requireWalletAddress(value);
  if (detected.family !== 'solana') throw new Error('Not a Solana public address');
  return detected.normalizedAddress;
}
