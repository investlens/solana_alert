export type ChainId =
  | 'solana'
  | 'robinhood';

export type ChainFamily =
  | 'SOLANA'
  | 'EVM';

export type ChainExecutionMode =
  | 'paper'
  | 'live';

export type ChainMarketSnapshot = {
  chain: ChainId;

  tokenAddress: string;

  symbol: string;
  name: string;

  priceUsd: number;

  marketCapUsd: number;
  fdvUsd?: number;
  liquidityUsd: number;

  volume5mUsd: number;

  buys5m: number;
  sells5m: number;

  pairAddress?: string;
  dexId?: string;

  chartUrl?: string;

  timestamp: number;
};

export type ChainTradeRequest = {
  chain: ChainId;

  tokenAddress: string;

  amountNative: number;

  mode: ChainExecutionMode;

  slippageBps?: number;
};

export type ChainSellRequest = {
  chain: ChainId;

  tokenAddress: string;

  percent: number;

  mode: ChainExecutionMode;

  slippageBps?: number;
};

export type ChainTradeResult = {
  success: boolean;

  chain: ChainId;

  tokenAddress: string;

  transactionId?: string;

  executedPrice?: number;

  error?: string;
};

export type ChainWalletBalance = {
  chain: ChainId;

  nativeSymbol: string;

  nativeBalance: number;
};
