import assert from 'node:assert/strict';
import test from 'node:test';
import { assessLowLoadTrendReversal } from '../src/chains/robinhood/lowLoadTrendReversal.js';

const observations = [
  { roi: -4, observedAt: '2026-09-27T15:00:00.000Z', volume5m: 1200, buys5m: 20, sells5m: 18, liquidity: 5000 },
  { roi: -1.5, observedAt: '2026-09-27T15:01:00.000Z', volume5m: 1800, buys5m: 28, sells5m: 20, liquidity: 5200 },
];

test('waits until the token is at least 30 minutes old', () => {
  const result = assessLowLoadTrendReversal({
    observations,
    previousState: 'COOLING', currentState: 'BUILDING', ageSeconds: 29 * 60,
    liquidityUsd: 5200, volume5mUsd: 1800, buys5m: 28, sells5m: 20,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'WAIT_30_MINUTES');
});

test('accepts a qualified recovery using only already-observed data', () => {
  const result = assessLowLoadTrendReversal({
    observations,
    previousState: 'COOLING', currentState: 'BUILDING', ageSeconds: 31 * 60,
    liquidityUsd: 5200, volume5mUsd: 1800, buys5m: 28, sells5m: 20,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'TREND_REVERSAL_CONFIRMED');
  assert.equal(result.recentRoiDeltaPct, 2.5);
});

test('rejects known developer or security risk without extra lookups', () => {
  const result = assessLowLoadTrendReversal({
    observations,
    previousState: 'WEAKENING', currentState: 'CONFIRMED', ageSeconds: 45 * 60,
    liquidityUsd: 5200, volume5mUsd: 1800, buys5m: 28, sells5m: 20,
    confirmedDevSell: true,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'KNOWN_RISK');
});

test('rejects weak flow even after 30 minutes', () => {
  const result = assessLowLoadTrendReversal({
    observations,
    previousState: 'COOLING', currentState: 'BUILDING', ageSeconds: 40 * 60,
    liquidityUsd: 5200, volume5mUsd: 1800, buys5m: 18, sells5m: 20,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'BUY_PRESSURE_NOT_CONFIRMED');
});
