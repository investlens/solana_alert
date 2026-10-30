import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionEchoTrade, canEchoSign, canEchoBroadcast } from '../src/echo/manualTradeLifecycle.js';

test('trade lifecycle permits only ordered transitions', () => {
  assert.deepEqual(transitionEchoTrade('reserved', 'SIGNED_DURABLY'), { allowed: true, next: 'signed' });
  assert.deepEqual(transitionEchoTrade('signed', 'SUBMITTED'), { allowed: true, next: 'submitted' });
  assert.deepEqual(transitionEchoTrade('submitted', 'CONFIRMED_ON_CHAIN'), { allowed: true, next: 'confirmed' });
  assert.equal(transitionEchoTrade('reserved', 'SUBMITTED').allowed, false);
  assert.equal(transitionEchoTrade('confirmed', 'SIGNED_DURABLY').allowed, false);
});

test('signed payload must be persisted and unknown outcome stays locked', () => {
  assert.equal(canEchoSign('reserved'), true);
  assert.equal(canEchoBroadcast('signed', false), false);
  assert.equal(canEchoBroadcast('signed', true), true);
  assert.deepEqual(transitionEchoTrade('submitted', 'OUTCOME_UNKNOWN'), { allowed: true, next: 'unknown' });
  assert.deepEqual(transitionEchoTrade('unknown', 'CONFIRMED_ON_CHAIN'), { allowed: true, next: 'confirmed' });
  assert.equal(canEchoSign('unknown'), false);
  assert.equal(canEchoBroadcast('unknown', true), false);
  assert.equal(canEchoSign('expired_unresolved'), false);
});
