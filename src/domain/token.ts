export type SupportedChain =
  | 'solana'
  | 'ethereum'
  | 'base'
  | 'bsc'
  | 'polygon'
  | 'ton'
  | 'robinhood'
  | string;

export type TokenLifecycleStatus =
  | 'DISCOVERED'
  | 'WATCHLIST'
  | 'QUALIFIED'
  | 'ALERTED'
  | 'MIGRATED'
  | 'ACTIVE'
  | 'COOLING'
  | 'DEAD'
  | 'UNKNOWN';

export interface TokenIdentity {
  chain: SupportedChain;
  tokenAddress: string;
  pairAddress?: string | null;
  symbol?: string | null;
  name?: string | null;
  dexId?: string | null;
  source?: string | null;
}

export interface TokenMarketSnapshot {
  capturedAt: string;
  priceUsd?: number | null;
  marketCapUsd?: number | null;
  fdvUsd?: number | null;
  liquidityUsd?: number | null;
  volume5mUsd?: number | null;
  volume1hUsd?: number | null;
  volume24hUsd?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
  buys1h?: number | null;
  sells1h?: number | null;
  holderCount?: number | null;
  top10HolderPercentage?: number | null;
  developerHoldingPercentage?: number | null;
  bundledSupplyPercentage?: number | null;
  ageMinutes?: number | null;
}

export interface TokenRecord extends TokenIdentity {
  id?: string;
  lifecycleStatus: TokenLifecycleStatus;
  creatorWallet?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  launchedAt?: string | null;
  migratedAt?: string | null;
  latestSnapshot?: TokenMarketSnapshot | null;
  metadata?: Record<string, unknown>;
}

export function createTokenKey(
  token: Pick<TokenIdentity, 'chain' | 'tokenAddress'>,
): string {
  return `${token.chain.toLowerCase()}:${token.tokenAddress}`;
}
