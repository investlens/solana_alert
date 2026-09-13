import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePositiveAlertSecurity,
  isPositiveSemanticEvent,
  labelLaunchType,
} from '../src/security/positiveAlertSecurity.js';

test('PONS remains on the existing security path', () => {
  const result = evaluatePositiveAlertSecurity({ launchType: 'PONS', raw: {} });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'PONS_EXISTING_SECURITY_PATH');
});

test('CUSTOM with unknown LP fails closed', () => {
  const result = evaluatePositiveAlertSecurity({ launchType: 'CUSTOM', raw: {} });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'CUSTOM_LP_UNVERIFIED_FAIL_CLOSED');
});

test('CUSTOM with claimed but unverified lock fails closed', () => {
  const result = evaluatePositiveAlertSecurity({ launchType: 'CUSTOM', raw: { lpStatus: 'LOCKED' } });
  assert.equal(result.allowed, false);
});

test('CUSTOM with verified lock is allowed', () => {
  const result = evaluatePositiveAlertSecurity({ launchType: 'CUSTOM', raw: {
    liquiditySafety: { status: 'LOCKED', verified: true },
  } });
  assert.equal(result.allowed, true);
  assert.equal(result.liquidityState, 'LOCKED');
});

test('CUSTOM with verified burn is allowed', () => {
  const result = evaluatePositiveAlertSecurity({ launchType: 'CUSTOM', raw: {
    liquiditySafetyStatus: 'BURNED', liquiditySafetyVerified: true,
  } });
  assert.equal(result.allowed, true);
  assert.equal(result.liquidityState, 'BURNED');
});

test('CUSTOM with verified unlocked LP is blocked', () => {
  const result = evaluatePositiveAlertSecurity({ launchType: 'CUSTOM', raw: {
    lpStatus: 'UNLOCKED', lpStatusVerified: true,
  } });
  assert.equal(result.allowed, false);
});

test('BOOST is a positive semantic event', () => {
  assert.equal(isPositiveSemanticEvent('BOOST'), true);
});

test('launch label is explicit and idempotent', () => {
  const once = labelLaunchType('🔥 ALPHAOS\nToken', 'CUSTOM');
  assert.match(once, /Launch: <b>CUSTOM<\/b>/);
  assert.equal(labelLaunchType(once, 'CUSTOM'), once);
});
