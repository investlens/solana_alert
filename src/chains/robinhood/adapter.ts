import type {
  ChainAdapter,
} from '../shared/chainAdapter.js';

import type {
  ChainSellRequest,
  ChainTradeRequest,
  ChainTradeResult,
  ChainWalletBalance,
} from '../shared/types.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

export const robinhoodAdapter:
  ChainAdapter = {
  id: 'robinhood',

  family: 'EVM',

  name: 'Robinhood Chain',

  nativeSymbol: 'ETH',

  async getMarketSnapshot(
    tokenAddress: string,
  ) {
    return getRobinhoodMarketSnapshot(
      tokenAddress,
    );
  },

  async buy(
    request: ChainTradeRequest,
  ): Promise<ChainTradeResult> {
    /*
     * Stage 3:
     * Execution intentionally disabled.
     *
     * We will connect this to Robinhood
     * paper trading first.
     */
    return {
      success: false,
      chain: 'robinhood',
      tokenAddress:
        request.tokenAddress,
      error:
        'Robinhood execution not enabled yet.',
    };
  },

  async sell(
    request: ChainSellRequest,
  ): Promise<ChainTradeResult> {
    return {
      success: false,
      chain: 'robinhood',
      tokenAddress:
        request.tokenAddress,
      error:
        'Robinhood execution not enabled yet.',
    };
  },

  async getWalletBalance():
    Promise<ChainWalletBalance> {
    /*
     * Wallet connection comes later.
     *
     * No private key is required during
     * market-data development.
     */
    return {
      chain: 'robinhood',
      nativeSymbol: 'ETH',
      nativeBalance: 0,
    };
  },

  getChartUrl(
    tokenAddress: string,
  ): string {
    return (
      'https://dexscreener.com/robinhood/' +
      tokenAddress
    );
  },

  getExplorerUrl(
    tokenAddress: string,
  ): string {
    return (
      'https://robinhoodchain.blockscout.com/' +
      'token/' +
      tokenAddress
    );
  },
};
