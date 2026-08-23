import { PublicKey } from '@solana/web3.js';
export { escapeTelegramHtml } from '../ui/escapeHtml.js';

export function normalizeSolanaPublicAddress(value: string): string {
  return new PublicKey(value.trim()).toBase58();
}
