import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { config } from '../config.js';

/**
 * AlphaOS is intentionally alert-only.
 *
 * This execution-layer guard is deliberately independent of runtime settings.
 * Even if a caller, environment variable, database setting, or future code path
 * attempts to enable trading, no on-chain buy/sell can be submitted from this
 * module. Manual external trading links remain unaffected.
 */
export const ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED = true as const;

export type AdminBuyResult = {
  signature: string;
  quote: unknown;
  walletAddress: string;
  requestedSolAmount: number;
  submittedLamports: string;
  tokenBalanceBefore: string;
  tokenBalanceAfter: string;
  tokensReceivedRaw: string;
  verified: boolean;
  balanceCheckFailed: boolean;
  reconciliationRequired: boolean;
};

export type AdminSellResult = {
  signature: string;
  quote: unknown;
  beforeBalance?: string;
  afterBalance?: string;
  balanceCheckFailed?: boolean;
};

function tradingDisabledError(): Error {
  return new Error('AlphaOS on-chain admin trading is permanently disabled; alerts only');
}

export async function adminBuyToken(_args: {
  outputMint: string;
  amountSol: number;
  slippageBps?: number;
}): Promise<AdminBuyResult> {
  throw tradingDisabledError();
}

export async function adminSellTokenPercent(_args: {
  inputMint: string;
  percent: 25 | 50 | 100;
  slippageBps?: number;
  priorityFeeLamports?: number | 'auto';
}): Promise<AdminSellResult> {
  throw tradingDisabledError();
}

export async function adminSellTokenPercentWithRetry(_args: {
  inputMint: string;
  percent: 25 | 50 | 100;
}): Promise<AdminSellResult> {
  throw tradingDisabledError();
}

export function getAdminTradingWalletAddress(): string {
  if (!config.adminTradingPrivateKey) {
    throw new Error('Missing ADMIN_TRADING_PRIVATE_KEY');
  }

  const secret = bs58.decode(config.adminTradingPrivateKey);
  return Keypair.fromSecretKey(secret).publicKey.toBase58();
}
