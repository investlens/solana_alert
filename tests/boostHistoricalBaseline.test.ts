import test from 'node:test';
import assert from 'node:assert/strict';
import { observeBoostCanonicalEvent } from '../src/chains/robinhood/boostCanonicalEvent.js';
const token = '0x1111111111111111111111111111111111111111';
test('late feed entry absorbs historical total, then emits a real increase without replay', () => {
  const totals = new Map<string, number>();
  assert.equal(observeBoostCanonicalEvent(totals, token.toUpperCase(), 100, 30), null);
  assert.equal(totals.get(token), 100);
  assert.equal(observeBoostCanonicalEvent(totals, token, 100, 30), null);
  const event = observeBoostCanonicalEvent(totals, token, 130, 30)!;
  assert.equal(event.type, 'BOOST_INCREASED'); assert.equal(event.boostAdded, 30);
  assert.equal(event.previousTotal, 100); assert.equal(totals.get(token), 100);
  totals.set(token, 130); // Existing delivery acknowledgement.
  assert.equal(observeBoostCanonicalEvent(totals, token, 130, 30), null);
});
test('absorbed history still detects the 500 threshold; fresh failures remain retryable', () => {
  const totals = new Map<string, number>();
  assert.equal(observeBoostCanonicalEvent(totals, token, 450, 50), null);
  assert.equal(observeBoostCanonicalEvent(totals, token, 500, 50)?.type, 'MAX_BOOST_500_PLUS');
  const fresh = new Map<string, number>();
  assert.equal(observeBoostCanonicalEvent(fresh, token, 30, 30)?.type, 'BOOST_DETECTED');
  assert.equal(fresh.size, 0);
  assert.equal(observeBoostCanonicalEvent(fresh, token, 30, 30)?.type, 'BOOST_DETECTED');
  assert.equal(observeBoostCanonicalEvent(fresh, token, NaN, 30), null);
  assert.equal(fresh.size, 0);
});
