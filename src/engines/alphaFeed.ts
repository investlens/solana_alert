
import { upsertAlphaSignal } from '../storage/signalStore.js';
import {
  calculateRoi,
  PERFORMANCE_PRICE_SOURCE_VERSION,
} from '../product/intelligenceCredibility.js';

export type AlphaSignalType =
  | 'DEX_PAID'
  | 'WHALE_CLUSTER'
  | 'WHALE_BUY'
  | 'CREATOR_INTEL'
  | 'MOMENTUM';

export type AlphaSignal = {
  id: string;
  type: AlphaSignalType;
  title: string;
  symbol: string;
  token: string;
  score?: number;
  conviction: string;
  createdAt: number;
  summary: string;
  dexUrl?: string;
  buyUrl?: string;

  alertPrice?: number | null;
  currentPrice?: number | null;
  highAfterAlert?: number | null;
  roiNow?: number | null;
  roiHigh?: number | null;
  priceSourceVersion?: string | null;
};

const signals: AlphaSignal[] = [];
const MAX_SIGNALS = 50;

function makeSignalKey(type: AlphaSignalType, token: string) {
  return `${type}:${token}`;
}

export function addAlphaSignal(signal: Omit<AlphaSignal, 'id' | 'createdAt'>) {
  const key = makeSignalKey(signal.type, signal.token);

  const existing = signals.find((s) => makeSignalKey(s.type, s.token) === key);

  if (existing) {
    if (signal.currentPrice != null) {
      existing.currentPrice = signal.currentPrice;

      const existingHigh = existing.highAfterAlert ?? existing.alertPrice ?? null;
      existing.highAfterAlert =
        existingHigh == null ? signal.currentPrice : Math.max(existingHigh, signal.currentPrice);

      existing.roiNow = calculateRoi(existing.alertPrice, existing.currentPrice);
      existing.roiHigh = calculateRoi(existing.alertPrice, existing.highAfterAlert);
      existing.priceSourceVersion = PERFORMANCE_PRICE_SOURCE_VERSION;
    }

    existing.score = signal.score ?? existing.score;
    existing.conviction = signal.conviction ?? existing.conviction;
    existing.summary = signal.summary ?? existing.summary;

    upsertAlphaSignal(existing).catch((e) =>
    console.error('alpha signal update failed:', e)
    );

    return;
  }

  const alertPrice = signal.alertPrice ?? signal.currentPrice ?? null;
  const currentPrice = signal.currentPrice ?? alertPrice;
  const highAfterAlert = signal.highAfterAlert ?? currentPrice;

  const newSignal = {
  ...signal,
  id: `${signal.type}-${signal.token}-${Date.now()}`,
  createdAt: Date.now(),
  alertPrice,
  currentPrice,
  highAfterAlert,
  roiNow: calculateRoi(alertPrice, currentPrice),
  roiHigh: calculateRoi(alertPrice, highAfterAlert),
  priceSourceVersion: PERFORMANCE_PRICE_SOURCE_VERSION,
};

signals.unshift(newSignal);

// persist async
upsertAlphaSignal(newSignal).catch((e) =>
  console.error('alpha signal upsert failed:', e)
);

  if (signals.length > MAX_SIGNALS) {
    signals.length = MAX_SIGNALS;
  }
}

export function updateAlphaSignalPrice(args: {
  type: AlphaSignalType;
  token: string;
  currentPrice: number | null;
}) {
  const signal = signals.find(
    (s) => s.type === args.type && s.token === args.token
  );

  if (!signal || args.currentPrice == null || !Number.isFinite(args.currentPrice)) return;

  signal.currentPrice = args.currentPrice;

  const existingHigh = signal.highAfterAlert ?? signal.alertPrice ?? null;
  signal.highAfterAlert =
    existingHigh == null ? args.currentPrice : Math.max(existingHigh, args.currentPrice);

  signal.roiNow = calculateRoi(signal.alertPrice, signal.currentPrice);
  signal.roiHigh = calculateRoi(signal.alertPrice, signal.highAfterAlert);
  signal.priceSourceVersion = PERFORMANCE_PRICE_SOURCE_VERSION;

  upsertAlphaSignal(signal).catch((e) =>
    console.error('alpha signal perf update failed:', e)
    );
}

export function getLatestAlphaSignals(limit = 10) {
  return signals.slice(0, limit);
}

export function getAlphaSignalsByType(type: AlphaSignalType, limit = 10) {
  return signals.filter((s) => s.type === type).slice(0, limit);
}
