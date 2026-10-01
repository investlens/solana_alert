import test from 'node:test';
import assert from 'node:assert/strict';
import { recordLaunchSocialEligibility, launchSocialEligibility, boostVerificationDue, recordBoostSecurityBlock, type BoostVerificationRetry } from '../src/chains/robinhood/alertEligibilityState.js';
test('failed social screening releases eligibility and successful screening stays eligible within TTL', () => {
  recordLaunchSocialEligibility('TOKEN_A', false, 1000);
  assert.equal(launchSocialEligibility('token_a', 2000), false);
  recordLaunchSocialEligibility('TOKEN_A', true, 3000);
  assert.equal(launchSocialEligibility('token_a', 4000), true);
  assert.equal(launchSocialEligibility('token_a', 3 * 60 * 60_000), null);
});
test('unavailable boost evidence preserves event totals and backs off instead of acknowledging', () => {
  const totals = new Map<string, number>([['token', 30]]), retries = new Map<string, BoostVerificationRetry>();
  assert.equal(recordBoostSecurityBlock(totals, retries, 'TOKEN', 60, true, 0), 'RETRY_PENDING');
  assert.equal(totals.get('token'), 30);
  assert.equal(boostVerificationDue(retries, 'token', 60, 1000), false);
  assert.equal(boostVerificationDue(retries, 'token', 60, 60_000), true);
  assert.equal(boostVerificationDue(retries, 'token', 90, 1000), true);
});
test('hard blocks acknowledge once; unavailable evidence has a bounded retry horizon', () => {
  const totals = new Map<string, number>(), retries = new Map<string, BoostVerificationRetry>();
  assert.equal(recordBoostSecurityBlock(totals, retries, 'token', 30, false, 0), 'HARD_BLOCK');
  assert.equal(totals.get('token'), 30); assert.equal(retries.size, 0);
  recordBoostSecurityBlock(totals, retries, 'token', 60, true, 0);
  assert.equal(recordBoostSecurityBlock(totals, retries, 'token', 60, true, 30 * 60_000), 'RETRY_EXHAUSTED');
  assert.equal(totals.get('token'), 60); assert.equal(retries.size, 0);
});
