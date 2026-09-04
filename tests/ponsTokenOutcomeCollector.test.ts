import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPonsTokenOutcomes, derivePonsCollectedOutcome, formatPonsOutcomeSummary, historicalObservationsFromRobinhoodRows,
  type PonsMarketObservation, type PonsOutcomeCollectorSource, type PonsOutcomeLaunch,
} from '../src/chains/robinhood/ponsTokenOutcomeCollector.js';

const tokenA = '0x1111111111111111111111111111111111111111';
const tokenB = '0x2222222222222222222222222222222222222222';
const developer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const launch = (token_address = tokenA): PonsOutcomeLaunch => ({ token_address, deployer_address: developer,
  factory_address: '0x3333333333333333333333333333333333333333', protocol_version: 'v2-current',
  block_timestamp: '2026-08-10T00:00:00.000Z' });
const observation = (tokenAddress: string, marketCap: number, observedAt: string, kind: 'HISTORICAL' | 'CURRENT'): PonsMarketObservation =>
  ({ tokenAddress, marketCap, observedAt, kind, source: kind === 'CURRENT' ? 'DEXSCREENER_ROBINHOOD_CURRENT' : 'ROBINHOOD_OBSERVATION_5M' });

test('current market cap remains current-only and never becomes peak', () => {
  const result = derivePonsCollectedOutcome(launch(), [observation(tokenA, 700_000, '2026-08-11T00:00:00.000Z', 'CURRENT')]);
  assert.equal(result.currentMarketCap, 700_000); assert.equal(result.peakMarketCap, null);
  assert.equal(result.crossed100k, null); assert.equal(result.dataConfidence, 'CURRENT_ONLY');
});

test('verified peak is the maximum of actual historical observations only', () => {
  const result = derivePonsCollectedOutcome(launch(), [
    observation(tokenA, 40_000, '2026-08-10T00:01:00.000Z', 'HISTORICAL'),
    observation(tokenA, 650_000, '2026-08-10T00:05:00.000Z', 'HISTORICAL'),
    observation(tokenA, 900_000, '2026-08-11T00:00:00.000Z', 'CURRENT'),
  ]);
  assert.equal(result.firstMarketCap, 40_000); assert.equal(result.peakMarketCap, 650_000);
  assert.equal(result.currentMarketCap, 900_000); assert.equal(result.peakSource, 'ROBINHOOD_OBSERVATION_5M');
  assert.equal(result.crossed100k, true); assert.equal(result.crossed500k, true); assert.equal(result.crossed1m, false);
});

test('no exact-token evidence remains unknown', () => {
  const result = derivePonsCollectedOutcome(launch(), []);
  assert.equal(result.currentMarketCap, null); assert.equal(result.peakMarketCap, null);
  assert.equal(result.observationCount, 0); assert.equal(result.dataConfidence, 'UNKNOWN');
});

test('mixed-token observations cannot contaminate outcomes', () => {
  const result = derivePonsCollectedOutcome(launch(tokenA), [
    observation(tokenB, 2_000_000, '2026-08-10T00:05:00.000Z', 'HISTORICAL'),
    observation(tokenA.toUpperCase(), 80_000, '2026-08-10T00:05:00.000Z', 'HISTORICAL'),
  ]);
  assert.equal(result.peakMarketCap, 80_000); assert.equal(result.crossed1m, false); assert.equal(result.observationCount, 1);
});

test('wallet overlap has no role in collector outcome identity', async () => {
  const source: PonsOutcomeCollectorSource = { loadLaunches: async () => [launch(tokenA)],
    loadHistoricalObservations: async () => [observation(tokenB, 2_000_000, '2026-08-10T00:05:00.000Z', 'HISTORICAL')],
    loadCurrentObservation: async () => null };
  const result = await collectPonsTokenOutcomes(source);
  assert.equal(result.outcomes[0].peakMarketCap, null); assert.equal(result.unknown, 1);
});

test('dry run never invokes persistence', async () => {
  let writes = 0;
  const source: PonsOutcomeCollectorSource = { loadLaunches: async () => [launch()], loadHistoricalObservations: async () => [],
    loadCurrentObservation: async row => observation(row.token_address, 50_000, '2026-08-11T00:00:00.000Z', 'CURRENT'),
    writeOutcomes: async () => { writes += 1; } };
  const result = await collectPonsTokenOutcomes(source, { write: false });
  assert.equal(writes, 0); assert.equal(result.wrote, false); assert.equal(result.currentMcFound, 1);
});

test('collector aggregation is deterministic regardless of historical input order', () => {
  const rows = [observation(tokenA, 100_000, '2026-08-10T00:01:00.000Z', 'HISTORICAL'),
    observation(tokenA, 500_000, '2026-08-10T00:05:00.000Z', 'HISTORICAL')];
  const forward = derivePonsCollectedOutcome(launch(), rows, new Date('2026-09-04T00:00:00Z'));
  const reverse = derivePonsCollectedOutcome(launch(), [...rows].reverse(), new Date('2026-09-04T00:00:00Z'));
  assert.deepEqual(forward, reverse);
});

test('Robinhood checkpoint fields become timestamped historical observations', () => {
  const rows = historicalObservationsFromRobinhoodRows([{ token_address: tokenA, decision_at: '2026-08-10T00:00:00Z',
    market_cap_at_decision: 20_000, market_cap_1m: 30_000, market_cap_5m: 120_000 }]);
  assert.deepEqual(rows.map(row => [row.marketCap, row.observedAt]), [
    [20_000, '2026-08-10T00:00:00.000Z'], [30_000, '2026-08-10T00:01:00.000Z'], [120_000, '2026-08-10T00:05:00.000Z'],
  ]);
});

test('collector reports bounded progress and counts individual lookup failures', async () => {
  const launches = Array.from({ length: 5 }, (_, index) => launch(index % 2 ? tokenA : tokenB));
  let calls = 0; const progress: number[] = [];
  const source: PonsOutcomeCollectorSource = { loadLaunches: async () => launches,
    loadHistoricalObservations: async () => [observation(tokenA, 120_000, '2026-08-10T00:05:00Z', 'HISTORICAL')],
    loadCurrentObservation: async row => { calls += 1; if (calls === 2) throw new Error('provider unavailable');
      return observation(row.token_address, 50_000, '2026-08-11T00:00:00Z', 'CURRENT'); } };
  const result = await collectPonsTokenOutcomes(source, { concurrency: 1, progressInterval: 2,
    onProgress: value => progress.push(value.processed) });
  assert.deepEqual(progress, [2, 4, 5]); assert.equal(result.currentLookupFailures, 1); assert.equal(result.scanned, 5);
});

test('per-token timeout aborts and counts a stuck current lookup instead of hanging', async () => {
  let aborted = false;
  const source: PonsOutcomeCollectorSource = { loadLaunches: async () => [launch()], loadHistoricalObservations: async () => [],
    loadCurrentObservation: async (_row, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => {
      aborted = true; reject(new Error('aborted'));
    }, { once: true })) };
  const result = await collectPonsTokenOutcomes(source, { currentRequestTimeoutMs: 5 });
  assert.equal(aborted, true); assert.equal(result.currentLookupFailures, 1); assert.equal(result.unknown, 1);
});

test('zero-launch collection is explicit and performs no market work', async () => {
  let historicalCalls = 0; let currentCalls = 0;
  const result = await collectPonsTokenOutcomes({ loadLaunches: async () => [],
    loadHistoricalObservations: async () => { historicalCalls += 1; return []; },
    loadCurrentObservation: async () => { currentCalls += 1; return null; } });
  assert.equal(result.scanned, 0); assert.equal(historicalCalls, 0); assert.equal(currentCalls, 0);
});

test('final summary includes thresholds, unknowns, failures, and dry-run write count', async () => {
  const source: PonsOutcomeCollectorSource = { loadLaunches: async () => [launch()],
    loadHistoricalObservations: async () => [observation(tokenA, 600_000, '2026-08-10T00:05:00Z', 'HISTORICAL')],
    loadCurrentObservation: async () => null };
  const result = await collectPonsTokenOutcomes(source);
  assert.deepEqual(formatPonsOutcomeSummary(result, true), [
    '[PonsOutcomes] scanned=1', '[PonsOutcomes] currentMcFound=0', '[PonsOutcomes] historicalObservationsFound=1',
    '[PonsOutcomes] verifiedPeakFound=1', '[PonsOutcomes] crossed100k=1', '[PonsOutcomes] crossed500k=1',
    '[PonsOutcomes] crossed1m=0', '[PonsOutcomes] crossed5m=0', '[PonsOutcomes] crossed10m=0',
    '[PonsOutcomes] unknown=0', '[PonsOutcomes] currentLookupFailures=0',
    '[PonsOutcomes] dryRun=true writes=0',
  ]);
});
