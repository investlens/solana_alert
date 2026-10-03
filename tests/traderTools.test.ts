import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReadiness, validReadinessMarket } from '../src/services/tradeReadiness.js';
import { deteriorationMask, type Monitor } from '../src/services/deteriorationMonitor.js';
import { renderReadiness, renderDeterioration, readinessButtons } from '../src/ui/tradeReadinessView.js';
import { accessProfileForTier, hasCapability } from '../src/product/capabilities.js';
import { alphaosFeatureGuide } from '../src/product/featureGuide.js';
import type { ChainMarketSnapshot } from '../src/chains/shared/types.js';
const token = '0x1111111111111111111111111111111111111111';
const pair = '0x2222222222222222222222222222222222222222';
const now = 1_000_000_000;
const market = (changes: Partial<ChainMarketSnapshot> = {}): ChainMarketSnapshot => ({ chain: 'robinhood', tokenAddress: token,
  pairAddress: pair, symbol: '<TAG>', name: 'Test', priceUsd: 1, marketCapUsd: 50_000, liquidityUsd: 10_000,
  volume5mUsd: 5_000, buys5m: 100, sells5m: 50, trades5mReported: true,
  pairCreatedAt: now - 60 * 60_000, priceChange1h: 5, timestamp: now, ...changes });
const row: Monitor = { token, pair, symbol: '<TAG>', price: 1, liquidity: 10_000, at: now - 180_000,
  expires: now + 3600_000, checked: now, users: ['1'], mask: 0, notices: 0 };
test('readiness never approves entry and stale, mismatched or incomplete critical evidence stays Watch', () => {
  assert.equal(assessReadiness(market(), token, now).state, 'SETUP_FORMING');
  for (const change of [{ timestamp: now - 120_001 }, { timestamp: now + 1 }, { tokenAddress: pair },
    { marketCapUsd: 0 }, { liquidityUsd: 1 }, { volume5mUsd: 0 }, { trades5mReported: false },
    { sells5m: 0 }, { pairCreatedAt: now }, { priceChange1h: NaN }])
    assert.equal(assessReadiness(market(change), token, now).state, 'WATCH', JSON.stringify(change));
  assert.equal(validReadinessMarket(market({ pairAddress: undefined }), token, now), false);
});
test('deterioration respects baseline, trigger/recovery hysteresis, pair and timestamp', () => {
  assert.equal(deteriorationMask(row, market({ priceUsd: 0.84 }), now), 1);
  assert.equal(deteriorationMask(row, market({ liquidityUsd: 7900 }), now), 2);
  assert.equal(deteriorationMask(row, market({ priceUsd: 0.8, liquidityUsd: 7000 }), now), 3);
  assert.equal(deteriorationMask({ ...row, mask: 1 }, market({ priceUsd: 0.87 }), now), 1);
  assert.equal(deteriorationMask({ ...row, mask: 1 }, market({ priceUsd: 0.91 }), now), 0);
  assert.equal(deteriorationMask(row, market({ pairAddress: token }), now), 8);
  assert.equal(deteriorationMask({ ...row, mask: 1 }, null, now), 5);
  assert.equal(deteriorationMask(row, market({ timestamp: now - 120_001 }), now), 4);
});
test('UI escapes project input, states boundaries and does not mislabel a data gap as a confirmed drop', () => {
  const text = renderReadiness(token, assessReadiness(market(), token, now));
  assert.match(text, /&lt;TAG&gt;/); assert.doesNotMatch(text, /<TAG>|ENTRY CONDITIONS MET/);
  assert.match(text, /No entry approval/);
  const warning = renderDeterioration(row, null, 4);
  assert.match(warning, /not a price-drop confirmation/);
  for (const button of readinessButtons(token).flat()) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
});
test('commercial free cannot start personal monitors; testing access remains open and guide describes that', () => {
  const previous = process.env.SUBSCRIPTIONS_ENABLED;
  try {
    process.env.SUBSCRIPTIONS_ENABLED = 'true';
    assert.equal(hasCapability(accessProfileForTier('free'), 'monitoring.personal'), false);
    assert.equal(hasCapability(accessProfileForTier('free'), 'trade.readiness'), false);
    assert.equal(hasCapability(accessProfileForTier('pro'), 'monitoring.personal'), true);
    process.env.SUBSCRIPTIONS_ENABLED = 'false';
    assert.equal(hasCapability(accessProfileForTier('free'), 'monitoring.personal'), true);
    assert.match(alphaosFeatureGuide(), /Payments remain closed/);
  } finally { if (previous == null) delete process.env.SUBSCRIPTIONS_ENABLED; else process.env.SUBSCRIPTIONS_ENABLED = previous; }
});
