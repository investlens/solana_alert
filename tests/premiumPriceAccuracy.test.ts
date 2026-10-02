import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPremiumTokenNotification } from '../src/ui/premiumTokenNotification.js';
import { normalizeNotificationMarketContext } from '../src/ui/notificationMarketContext.js';
test('boost and opportunity prices preserve scientific exponents exactly', () => {
  for (const state of ['BOOST', 'OPPORTUNITY'] as const) {
    const message = buildPremiumTokenNotification({ state, symbol: 'TINY', address: '0xabc',
      market: normalizeNotificationMarketContext({ price: 1e-10 }), insightTitle: 'Research', insight: [],
      statusTitle: 'Status', status: 'Research only' });
    assert.match(message, /\$1e-10/); assert.doesNotMatch(message, /\$1e-1(?:<|\s)/);
  }
});
