import type { WalletWatchEvent } from '../core/walletWatcher.js';

export type WalletActivityView = {
  id: number | null; type: 'BUY' | 'SELL' | 'SEND' | 'RECEIVE' | 'LAUNCH';
  transactionHash: string; wallet: string; blockNumber: number | null; timestamp: string | null;
  tokenContract: string | null; tokenSymbol: string | null; tokenName: string | null;
  tokenDecimals: number | null; rawTokenAmount: string | null; normalizedTokenAmount: number | null;
  nativeAmount: number | null; quoteSymbol: string | null; counterparty: string | null;
};

const finite = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export function walletActivityMetadata(event: WalletWatchEvent): Record<string, unknown> {
  const source = event as unknown as Record<string, unknown>;
  return {
    schema_version: 2,
    chain: event.chain ?? 'solana', transaction_hash: event.signature,
    block_number: event.blockNumber ?? null, timestamp: event.timestamp ?? null,
    token_contract: event.tokenMint ?? null, token_symbol: source.tokenSymbol ?? null,
    token_name: source.tokenName ?? null, token_decimals: source.tokenDecimals ?? null,
    raw_token_amount: source.tokenAmountRaw ?? null, normalized_token_amount: source.tokenAmount ?? null,
    native_amount: source.nativeAmount ?? source.amountSol ?? null,
    quote_symbol: source.quoteSymbol ?? ((source.amountSol != null) ? 'SOL' : null),
    counterparty: source.counterparty ?? null,
  };
}

export function normalizeWalletActivityRow(row: Record<string, unknown>): WalletActivityView {
  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  const epoch = finite(metadata.timestamp);
  return {
    id: finite(row.id), type: String(row.activity_type ?? row.action ?? 'RECEIVE').toUpperCase() as WalletActivityView['type'],
    transactionHash: text(metadata.transaction_hash) ?? text(row.transaction_signature) ?? '',
    wallet: text(row.wallet_address) ?? '', blockNumber: finite(metadata.block_number),
    timestamp: epoch != null ? new Date(epoch * 1000).toISOString() : text(row.created_at),
    tokenContract: text(metadata.token_contract) ?? text(row.token_address),
    tokenSymbol: text(metadata.token_symbol), tokenName: text(metadata.token_name),
    tokenDecimals: finite(metadata.token_decimals), rawTokenAmount: text(metadata.raw_token_amount),
    normalizedTokenAmount: finite(metadata.normalized_token_amount), nativeAmount: finite(metadata.native_amount),
    quoteSymbol: text(metadata.quote_symbol), counterparty: text(metadata.counterparty),
  };
}

export function humanAge(timestamp: string | null, now = new Date()): string {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return 'Unknown';
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(timestamp)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function shortWalletValue(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

export function activityTokenLabel(activity: WalletActivityView): string {
  const fallback = activity.tokenContract ? shortWalletValue(activity.tokenContract) : 'Unknown token';
  if (activity.tokenName && activity.tokenSymbol) return `${activity.tokenName} (${activity.tokenSymbol})`;
  return activity.tokenSymbol ?? activity.tokenName ?? fallback;
}

export function formatActivityAmount(value: number | null): string | null {
  if (value == null) return null;
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
