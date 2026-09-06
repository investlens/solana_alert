import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStartDatabaseWork,
  databaseGovernorSnapshot,
  isTransientDatabaseError,
  recordDatabaseFailure,
  recordDatabaseSuccess,
  resetDatabaseGovernorForTests,
} from '../src/services/databaseLoadGovernor.js';

test('recognizes transient Supabase/PostgREST pressure failures', () => {
  assert.equal(isTransientDatabaseError({ code: 'PGRST002', message: 'schema cache' }), true);
  assert.equal(isTransientDatabaseError({ status: 504, message: 'timeout' }), true);
  assert.equal(isTransientDatabaseError(new Error('statement timeout')), true);
  assert.equal(isTransientDatabaseError(new Error('duplicate key value')), false);
});

test('background circuit opens after repeated transient failures while critical work remains allowed', () => {
  resetDatabaseGovernorForTests();
  const now = 1_000;
  recordDatabaseFailure({ code: 'PGRST002' }, 'BACKGROUND', now);
  recordDatabaseFailure({ code: 'PGRST002' }, 'BACKGROUND', now);
  assert.equal(canStartDatabaseWork('BACKGROUND', now), true);
  recordDatabaseFailure({ code: 'PGRST002' }, 'BACKGROUND', now);
  assert.equal(databaseGovernorSnapshot(now).state, 'OPEN');
  assert.equal(canStartDatabaseWork('BACKGROUND', now), false);
  assert.equal(canStartDatabaseWork('CRITICAL', now), true);
});

test('successful background probe closes the circuit', () => {
  resetDatabaseGovernorForTests();
  const now = 1_000;
  for (let i = 0; i < 3; i += 1) recordDatabaseFailure({ status: 503 }, 'BACKGROUND', now);
  const openUntil = databaseGovernorSnapshot(now).openUntil;
  assert.equal(canStartDatabaseWork('BACKGROUND', openUntil + 1), true);
  recordDatabaseSuccess('BACKGROUND');
  assert.equal(databaseGovernorSnapshot(openUntil + 1).state, 'CLOSED');
});
