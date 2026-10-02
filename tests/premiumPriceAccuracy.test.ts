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

test('boost sections preserve spacing and sourced activity without empty social heading', () => {
  const args = { state: 'BOOST' as const, symbol: 'IF', name: 'What If', address: '0x232CDFc415D10b673845D83Dc02ba2eaBe7e30d1', chain: 'robinhood',
    market: normalizeNotificationMarketContext({ price: 0.0003591, marketCap: 320700, liquidity: 83900, volume5m: 70 }),
    insightTitle: 'Research', insight: ['LP UNLOCKED'], statusTitle: 'Security', status: 'LP UNLOCKED', socials: {},
    boostTotal: 30, boostIncrement: 30, age: '2h', move1h: -1.5, buys5m: 3, sells5m: 0,
    source: 'DEXScreener', observedAt: '2026-10-02T10:39:00Z' };
  const text = buildPremiumTokenNotification(args);
  assert.match(text, /Robinchain/); assert.match(text, /\n\n<b>STATS<\/b>/); assert.match(text, /\n\n<b>RISK<\/b>/);
  assert.match(text, /Socials: Not listed/); assert.doesNotMatch(text, /SOCIAL LINKS/);
  assert.match(text, /3 buy \/ 0 sell/); assert.match(text, /-1.50%/); assert.match(text, /Checked 10:39:00 UTC/);
  assert.match(text, /HIGH RUG RISK/); assert.ok(text.length <= 1024);
  const missing = buildPremiumTokenNotification({ ...args, age: null, move1h: null, buys5m: null, sells5m: null });
  assert.doesNotMatch(missing, /Pair age|Move · 1h|Trades · 5m/);
});
