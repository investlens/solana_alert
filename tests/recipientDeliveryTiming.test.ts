import test from 'node:test';
import assert from 'node:assert/strict';
import { recipientDelayMs, remainingDeliveryDelay, isUndelayedRiskEvent } from '../src/services/recipientDeliveryTiming.js';
const now = Date.parse('2026-10-03T12:00:00Z');
const paid = {tier:'paid', subscription_status:'active', paid_active_until:'2026-10-04T12:00:00Z'};
test('delivery tiers require current membership independently of billing', () => {
  assert.equal(recipientDelayMs({tier:'admin'}, now), 0);
  assert.equal(recipientDelayMs(paid, now), 5000);
  assert.equal(recipientDelayMs({tier:'free'}, now), 30000);
  assert.equal(recipientDelayMs({...paid, paid_active_until:null}, now), 30000);
  assert.equal(recipientDelayMs({...paid, paid_active_until:new Date(now).toISOString()}, now), 30000);
  assert.equal(recipientDelayMs({}, now), 30000);
});
test('release deadline is shared, never a new delay for each subscriber', () => {
  assert.equal(remainingDeliveryDelay({tier:'free'}, now, now+5000), 25000);
  assert.equal(remainingDeliveryDelay({tier:'free'}, now, now+31000), 0);
  assert.equal(remainingDeliveryDelay(paid, now, now+6000), 0);
});
test('risk events bypass every tier delay using event identity', () => {
  for (const type of ['EXIT','DANGER','DEV_SELL','LIQUIDITY_RISK','WEAKENING','WALLET_CLUSTER']) {
    assert.equal(isUndelayedRiskEvent(type), true);
    assert.equal(remainingDeliveryDelay({tier:'free'}, now, now, isUndelayedRiskEvent(type)), 0);
  }
  assert.equal(isUndelayedRiskEvent('BOOST'), false);
});
