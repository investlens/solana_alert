import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePonsLaunchClassification,
} from '../src/chains/robinhood/launchSecurity.js';

test('verified PONS factory result remains PONS', () => {
  assert.equal(
    resolvePonsLaunchClassification(true, 'PONS'),
    'PONS',
  );
});

test('definitive non-PONS becomes CUSTOM only when durable lookup was available', () => {
  assert.equal(
    resolvePonsLaunchClassification(true, 'NOT_PONS'),
    'CUSTOM',
  );

  assert.equal(
    resolvePonsLaunchClassification(false, 'NOT_PONS'),
    'UNKNOWN',
  );
});

test('factory verification unavailable always fails closed to UNKNOWN', () => {
  assert.equal(
    resolvePonsLaunchClassification(true, 'UNAVAILABLE'),
    'UNKNOWN',
  );

  assert.equal(
    resolvePonsLaunchClassification(false, 'UNAVAILABLE'),
    'UNKNOWN',
  );
});
