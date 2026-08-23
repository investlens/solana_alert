import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { accessProfileForTier, hasCapability } from '../src/product/capabilities.js';
import {
  assessPerformance,
  calculateRoi,
  creatorHistory,
  creatorSummary,
  formatPercentage,
  formatRate,
  smartMoneyHistory,
  smartMoneySummary,
} from '../src/product/intelligenceCredibility.js';
import { chooseBestPair } from '../src/services/dexscreener.js';
import { escapeTelegramHtml } from '../src/ui/escapeHtml.js';

test('canonical ROI handles ordinary, tiny, zero and malformed prices', () => {
  assert.equal(calculateRoi(100, 125), 25);
  assert.equal(calculateRoi(0.000000000001, 0.000000000002), 100);
  assert.equal(calculateRoi(0, 10), null);
  assert.equal(calculateRoi(-1, 10), null);
  assert.equal(calculateRoi('malformed', 10), null);
  assert.equal(calculateRoi(10, Number.POSITIVE_INFINITY), null);
});

test('legitimate very-large ROI is calculated without capping', () => {
  assert.equal(calculateRoi(0.000001, 1), 99_999_900);
  assert.equal(assessPerformance({
    referencePrice: 0.000001,
    peakPrice: 1,
    currentPrice: 0.5,
    updatedAt: '2026-08-23T00:00:00Z',
    now: Date.parse('2026-08-23T01:00:00Z'),
    sourceVerified: true,
  }).status, 'AVAILABLE');
  assert.equal(assessPerformance({
    referencePrice: 0.000001,
    peakPrice: 1,
    currentPrice: 1,
    updatedAt: '2026-08-23T00:30:00Z',
    now: Date.parse('2026-08-23T01:00:00Z'),
    sourceVerified: true,
  }).status, 'AVAILABLE');
});

test('unverified extreme observations are flagged rather than capped', () => {
  const result = assessPerformance({
    referencePrice: 0.0002413,
    peakPrice: 4.35,
    currentPrice: 4.35,
    updatedAt: '2026-07-20T06:40:00Z',
    now: Date.parse('2026-08-23T00:00:00Z'),
  });
  assert.equal(result.status, 'SOURCE_REVIEW');
  assert.equal(result.stale, true);
  assert.ok((result.peakRoi ?? 0) > 1_800_000);
  assert.equal(assessPerformance({
    referencePrice: 1,
    peakPrice: 1.25,
    currentPrice: 1.1,
    updatedAt: '2026-08-23T00:00:00Z',
    now: Date.parse('2026-08-23T01:00:00Z'),
  }).status, 'SOURCE_REVIEW');
});

test('missing current price and stale observations remain explicit', () => {
  const result = assessPerformance({
    referencePrice: 1,
    peakPrice: 2,
    currentPrice: null,
    updatedAt: '2026-08-20T00:00:00Z',
    now: Date.parse('2026-08-23T00:00:01Z'),
    sourceVerified: true,
  });
  assert.equal(result.currentRoi, null);
  assert.equal(result.stale, true);
  assert.equal(formatPercentage(result.currentRoi), 'Unavailable');
});

test('Smart Money distinguishes insufficient, early and established samples', () => {
  assert.deepEqual(smartMoneyHistory(0), {
    measured: 0, maturity: 'INSUFFICIENT DATA', showWinRate: false,
  });
  assert.deepEqual(smartMoneyHistory(3), {
    measured: 3, maturity: 'EARLY HISTORY', showWinRate: true,
  });
  assert.deepEqual(smartMoneyHistory(44), {
    measured: 44, maturity: 'ESTABLISHED HISTORY', showWinRate: true,
  });
  assert.equal(smartMoneySummary({
    completedTrades: 0, totalBuys: 1, winRate: 0,
  }), '0 measured of 1 observed · score withheld until 3 measured');
  assert.equal(smartMoneySummary({
    completedTrades: 44, totalBuys: 193, winRate: 4.545,
  }), '44 measured · 4.5% recorded positive rate');
});

test('Creator presentation separates observed from measured outcomes', () => {
  assert.deepEqual(creatorHistory({
    totalLaunches: 54, successfulLaunches: 0, failedLaunches: 0,
  }), { observed: 54, successful: 0, failed: 0, measured: 0 });
  assert.deepEqual(creatorHistory({
    totalLaunches: 30, successfulLaunches: 8, failedLaunches: 12,
  }), { observed: 30, successful: 8, failed: 12, measured: 20 });
  assert.deepEqual(creatorSummary({
    totalLaunches: 54, successfulLaunches: 0, failedLaunches: 0,
  }), ['54 launches observed', 'Measured outcomes unavailable']);
  assert.deepEqual(creatorSummary({
    totalLaunches: 30, successfulLaunches: 8, failedLaunches: 12,
  }), ['30 launches observed', '8/20 measured reached the success threshold']);
});

test('percentage formatting never emits NaN or Infinity', () => {
  assert.equal(formatPercentage(45.868), '+45.9%');
  assert.equal(formatPercentage(18_234.2), '+18,234%');
  assert.equal(formatPercentage(Number.NaN), 'Unavailable');
  assert.equal(formatPercentage(Number.POSITIVE_INFINITY), 'Unavailable');
  assert.equal(formatRate(4.545), '4.5%');
  assert.equal(formatRate(101), 'Unavailable');
});

test('pair selection never uses another base token price for the tracked mint', () => {
  const token = 'tracked-mint';
  const selected = chooseBestPair([
    {
      pairAddress: 'wrong',
      baseToken: { address: 'other-token' },
      quoteToken: { address: token },
      liquidity: { usd: 1_000_000_000 },
      priceUsd: '4.35',
    },
    {
      pairAddress: 'correct',
      baseToken: { address: token },
      liquidity: { usd: 20_000 },
      priceUsd: '0.0002',
    },
  ], token);
  assert.equal(selected?.pairAddress, 'correct');
});

test('credibility UI remains escaped and tier boundaries remain enforced', () => {
  assert.equal(escapeTelegramHtml('<UNKNOWN & risky>'), '&lt;UNKNOWN &amp; risky&gt;');
  const free = accessProfileForTier('free');
  const pro = accessProfileForTier('pro');
  const admin = accessProfileForTier('admin');
  assert.equal(hasCapability(free, 'intelligence.performance'), false);
  assert.equal(hasCapability(pro, 'intelligence.performance'), true);
  assert.equal(hasCapability(admin, 'intelligence.performance'), true);
  assert.equal(hasCapability(pro, 'trading.admin'), false);
});

test('active performance paths pass the tracked mint to pair selection', async () => {
  const signalEngine = await readFile(new URL('../src/engines/signalPerformanceEngine.ts', import.meta.url), 'utf8');
  const marketManager = await readFile(new URL('../src/core/autoTradeManager.ts', import.meta.url), 'utf8');
  const dexscreener = await readFile(new URL('../src/services/dexscreener.ts', import.meta.url), 'utf8');
  assert.match(signalEngine, /chooseBestPair\(pairs, signal\.token\)/);
  assert.match(marketManager, /chooseBestPair\(pairs, token\)/);
  assert.match(dexscreener, /chooseBestPair\(pairs, tokenAddress\)/);
});

test('legacy performance remains unverified while new base-token prices carry provenance', async () => {
  const signalStore = await readFile(new URL('../src/storage/signalStore.ts', import.meta.url), 'utf8');
  const intelligence = await readFile(new URL('../src/services/intelligenceService.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20260823190000_alpha_signal_price_provenance.sql', import.meta.url), 'utf8');
  assert.match(signalStore, /price_source_version: signal\.priceSourceVersion/);
  assert.match(intelligence, /\.eq\('price_source_version', PERFORMANCE_PRICE_SOURCE_VERSION\)/);
  assert.match(intelligence, /price_source_version\.is\.null/);
  assert.match(migration, /add column if not exists price_source_version text/);
  assert.doesNotMatch(migration, /update public\.alpha_signals|drop table|truncate/i);
});

test('creator rediscovery is checked before launch totals are incremented', async () => {
  const source = await readFile(new URL('../src/agents/creatorIntelligenceAgent.ts', import.meta.url), 'utf8');
  const duplicateGuard = source.indexOf('if (existingLaunchEvent)');
  const increment = source.indexOf('const totalLaunches');
  assert.ok(duplicateGuard >= 0 && duplicateGuard < increment);
});
