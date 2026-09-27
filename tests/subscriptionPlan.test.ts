import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALPHAOS_SUBSCRIPTION_PLAN,
  assertSubscriptionsEnabled,
  deliveryDelayMsForTier,
  paidAccessIsCurrent,
  subscriptionsEnabled,
} from '../src/product/subscriptionPlan.js';
import {
  accessProfileForUser,
  hasCapability,
} from '../src/product/capabilities.js';

function withSubscriptionFlag(value: string | undefined, run: () => void) {
  const previous = process.env.SUBSCRIPTIONS_ENABLED;
  if (value == null) delete process.env.SUBSCRIPTIONS_ENABLED;
  else process.env.SUBSCRIPTIONS_ENABLED = value;
  try {
    run();
  } finally {
    if (previous == null) delete process.env.SUBSCRIPTIONS_ENABLED;
    else process.env.SUBSCRIPTIONS_ENABLED = previous;
  }
}

test('AlphaOS subscription commercial terms stay locked', () => {
  assert.deepEqual(ALPHAOS_SUBSCRIPTION_PLAN.publicTiers, ['free', 'pro']);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.intro.priceUsdEquivalent, 1);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.intro.accessDays, 15);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.renewal.priceUsdEquivalent, 49);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.renewal.accessDays, 30);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.deliveryDelaySeconds.admin, 0);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.deliveryDelaySeconds.pro, 5);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.deliveryDelaySeconds.free, 30);
  assert.equal(ALPHAOS_SUBSCRIPTION_PLAN.paymentRail, 'ROBINHOOD_CHAIN_NATIVE_EQUIVALENT');
});

test('paid subscriptions fail closed by default', () => {
  withSubscriptionFlag(undefined, () => {
    assert.equal(subscriptionsEnabled(), false);
    assert.throws(() => assertSubscriptionsEnabled(), /not enabled yet/i);
  });
});

test('subscription gate can be explicitly enabled only by environment flag', () => {
  withSubscriptionFlag('true', () => {
    assert.equal(subscriptionsEnabled(), true);
    assert.doesNotThrow(() => assertSubscriptionsEnabled());
  });
});

test('all validation testers stay immediate while subscriptions are disabled', () => {
  withSubscriptionFlag('false', () => {
    assert.equal(deliveryDelayMsForTier('admin'), 0);
    assert.equal(deliveryDelayMsForTier('pro'), 0);
    assert.equal(deliveryDelayMsForTier('free'), 0);

    const tester = accessProfileForUser({ tier: 'free', subscription_status: 'inactive' });
    assert.equal(tester.tier, 'free');
    assert.equal(hasCapability(tester, 'wallets.track'), true);
    assert.equal(hasCapability(tester, 'intelligence.smartMoney'), true);
  });
});

test('commercial delivery timing activates only after subscription launch', () => {
  withSubscriptionFlag('true', () => {
    assert.equal(deliveryDelayMsForTier('admin'), 0);
    assert.equal(deliveryDelayMsForTier('pro'), 5_000);
    assert.equal(deliveryDelayMsForTier('free'), 30_000);
    assert.equal(deliveryDelayMsForTier('free', { safetyCritical: true }), 0);
    assert.equal(deliveryDelayMsForTier('pro', { safetyCritical: true }), 0);
  });
});

test('Pro access requires an active unexpired paid subscription after launch', () => {
  const now = Date.parse('2026-09-27T17:00:00Z');
  const active = {
    tier: 'paid',
    subscription_status: 'active',
    paid_active_until: '2026-10-27T17:00:00Z',
  };
  const expired = {
    tier: 'paid',
    subscription_status: 'active',
    paid_active_until: '2026-09-26T17:00:00Z',
  };

  assert.equal(paidAccessIsCurrent(active, now), true);
  assert.equal(paidAccessIsCurrent(expired, now), false);
  assert.equal(paidAccessIsCurrent({ ...active, subscription_status: 'expired' }, now), false);

  withSubscriptionFlag('true', () => {
    const previousNow = Date.now;
    Date.now = () => now;
    try {
      const pro = accessProfileForUser(active);
      assert.equal(pro.tier, 'pro');
      assert.equal(hasCapability(pro, 'wallets.track'), true);
      assert.equal(hasCapability(pro, 'intelligence.smartMoney'), true);

      const free = accessProfileForUser(expired);
      assert.equal(free.tier, 'free');
      assert.equal(hasCapability(free, 'wallets.track'), false);
      assert.equal(hasCapability(free, 'intelligence.smartMoney'), false);
      assert.equal(hasCapability(free, 'opportunities.view'), true);
    } finally {
      Date.now = previousNow;
    }
  });
});
