import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALPHAOS_SUBSCRIPTION_PLAN,
  assertSubscriptionsEnabled,
  subscriptionsEnabled,
} from '../src/product/subscriptionPlan.js';

test('AlphaOS subscription commercial terms stay locked', () => {
  assert.deepEqual(ALPHAOS_SUBSCRIPTION_PLAN.publicTiers, ['free', 'pro']);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.intro.priceUsdEquivalent, 1);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.intro.accessDays, 15);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.renewal.priceUsdEquivalent, 49);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.renewal.accessDays, 30);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.deliveryDelaySeconds.pro, 5);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.deliveryDelaySeconds.free, 30);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.paymentRail, 'ROBINHOOD_CHAIN_NATIVE_EQUIVALENT');
});

test('paid subscriptions fail closed by default', () => {
  const previous = process.env.SUBSCRIPTIONS_ENABLED;
  delete process.env.SUBSCRIPTIONS_ENABLED;
  try {
    assert.equal(subscriptionsEnabled(), false);
    assert.throws(() => assertSubscriptionsEnabled(), /not enabled yet/i);
  } finally {
    if (previous == null) delete process.env.SUBSCRIPTIONS_ENABLED;
    else process.env.SUBSCRIPTIONS_ENABLED = previous;
  }
});

test('subscription gate can be explicitly enabled only by environment flag', () => {
  const previous = process.env.SUBSCRIPTIONS_ENABLED;
  process.env.SUBSCRIPTIONS_ENABLED = 'true';
  try {
    assert.equal(subscriptionsEnabled(), true);
    assert.doesNotThrow(() => assertSubscriptionsEnabled());
  } finally {
    if (previous == null) delete process.env.SUBSCRIPTIONS_ENABLED;
    else process.env.SUBSCRIPTIONS_ENABLED = previous;
  }
});
