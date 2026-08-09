import type {
  ChainFamily,
  ChainId,
  ChainMarketSnapshot,
  ChainSellRequest,
  ChainTradeRequest,
  ChainTradeResult,
  ChainWalletBalance,
} from './types.js';

export interface ChainAdapter {
  readonly id: ChainId;

  readonly family: ChainFamily;

  readonly name: string;

  readonly nativeSymbol: string;

  getMarketSnapshot(
    tokenAddress: string,
  ): Promise<ChainMarketSnapshot | null>;

  buy(
    request: ChainTradeRequest,
  ): Promise<ChainTradeResult>;

  sell(
    request: ChainSellRequest,
  ): Promise<ChainTradeResult>;

  getWalletBalance(): Promise<ChainWalletBalance>;

  getChartUrl(
    tokenAddress: string,
  ): string;

  getExplorerUrl(
    tokenAddress: string,
  ): string;
}
