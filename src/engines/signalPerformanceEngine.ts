import { getLatestAlphaSignals, updateAlphaSignalPrice } from './alphaFeed.js';
import { fetchPairs, chooseBestPair } from '../services/dexscreener.js';

export async function runSignalPerformanceEngine() {
  const signals = getLatestAlphaSignals(30);

  for (const signal of signals) {
    try {
      const pairs = await fetchPairs(signal.token);
      const pair: any = chooseBestPair(pairs);

      if (!pair?.priceUsd) continue;

      updateAlphaSignalPrice({
        type: signal.type,
        token: signal.token,
        currentPrice: Number(pair.priceUsd),
      });
    } catch (error) {
      console.log('signal performance update failed:', signal.token, error);
    }
  }
}