import { config } from '../config.js';

export type TradingStatus = {
  executionMode: 'LIVE' | 'PAPER';

  autoTradeEnabled: boolean;

  scannerRunning: boolean;
  aiRunning: boolean;
  positionManagerRunning: boolean;

  wallet: {
    connected: boolean;
    address: string | null;
  };

  trading: {
    tradeSize: number;
    maxOpenTrades: number;
  };
};

export async function getTradingStatus(): Promise<TradingStatus> {
  const executionMode: 'LIVE' | 'PAPER' =
    config.autoTradeMode === 'paper' ? 'PAPER' : 'LIVE';

  return {
    executionMode,

    autoTradeEnabled: config.adminTradingEnabled,

    /*
     * These are temporary operational values.
     * We will connect them to live engine health shortly.
     */
    scannerRunning: true,
    aiRunning: true,
    positionManagerRunning: true,

    wallet: {
      connected:
        config.adminTradingEnabled &&
        config.adminTradingPrivateKey.trim().length > 0,
      address: null,
    },

    trading: {
      tradeSize: config.adminBuyAmountDefaultSol,
      maxOpenTrades: config.autoTradeMaxOpenPositions,
    },
  };
}