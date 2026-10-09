import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReadiness, validReadinessMarket, refreshReadinessEvidence } from '../src/services/tradeReadiness.js';
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
  volume5mUsd: 5_000, volume5mReported: true, buys5m: 100, sells5m: 50, trades5mReported: true,
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

test('DOVE-style V4 pool ID is supported without accepting mismatched tokens or arbitrary pool identifiers', () => {
  const pool = '0xc088dabf68ae649397e70c4a5e2ea35445e9c5682f8e9de9109cc808e52d676d';
  const snapshot = market({ pairAddress: pool, symbol: 'DOVE', priceUsd: 0.0001276, liquidityUsd: 5500.73 });
  assert.equal(validReadinessMarket(snapshot, token, now), true);
  assert.equal(deteriorationMask({ ...row, pair: pool, price: snapshot.priceUsd, liquidity: snapshot.liquidityUsd }, snapshot, now), 0);
  assert.equal(validReadinessMarket(market({ pairAddress: pool + '0' }), token, now), false);
  assert.equal(validReadinessMarket(market({ pairAddress: pool, tokenAddress: pair }), token, now), false);
});
test('unavailable readiness is compact, has no enrollment button and remains research-only', () => {
  const result = assessReadiness(null, token, now);
  const text = renderReadiness(token, result);
  assert.ok(text.length < 600);
  assert.doesNotMatch(text, /PERSONAL MONITOR|SETUP FORMING|Position Check/);
  assert.equal(readinessButtons(token, false).flat().some(b => b.callback_data.startsWith('DM_RH_')), false);
  assert.equal(readinessButtons(token, true).flat().some(b => b.callback_data.startsWith('DM_RH_')), true);
});

test('readiness distinguishes confirmed zero activity from absent activity and exposes all unmet checks', () => {
 const absent = assessReadiness(market({volume5mUsd:5000,volume5mReported:false}),token,now);
 assert.equal(absent.state,'WATCH');
 assert.equal(absent.checks?.find(c=>c.label==='5m activity')?.state,'UNVERIFIED');
 const inactive = assessReadiness(market({volume5mUsd:0}),token,now);
 assert.equal(inactive.checks?.find(c=>c.label==='5m activity')?.state,'BELOW');
 assert.match(renderReadiness(token,inactive),/Vol · 5m <b>\$0/);
 const incomplete = assessReadiness(market({marketCapUsd:0,liquidityUsd:5000,volume5mReported:false,
   trades5mReported:false,pairCreatedAt:undefined,priceChange1h:undefined}),token,now);
 assert.equal(incomplete.reasons.length,6);assert.equal(incomplete.checks?.length,6);
 assert.ok(incomplete.checks?.every(c=>c.state!=='MET'));
});
test('cached research revalidates snapshot and ownership ages without a provider request', () => {
 const current=assessReadiness(market(),token,now);
 const ownership={creator:pair,devPercent:0,devObservedAt:now,devBlock:'12345',top10Percent:22,
   top10Coverage:'INDEXED_SAMPLE' as const,top10ObservedAt:now};
 const recent=refreshReadinessEvidence({...current,ownership},token,now+30000);
 assert.equal(recent.ownership?.devPercent,0);assert.equal(recent.ownership?.top10Percent,22);
 const staleOwnership=refreshReadinessEvidence({...current,ownership},token,now+60001);
 assert.equal(staleOwnership.ownership?.devPercent,null);assert.equal(staleOwnership.ownership?.top10Percent,null);
 const staleMarket=refreshReadinessEvidence({...current,ownership},token,now+120001);
 assert.equal(staleMarket.market,null);assert.equal(staleMarket.state,'WATCH');
 assert.equal(staleMarket.ownership,undefined);
 const text=renderReadiness(token,recent);
 assert.match(text,/Creator holding <b>0.00%/);assert.match(text,/coverage may be partial/);
 assert.doesNotMatch(text,/win probability.*[0-9]+%|safe to buy/i);
});
test('research keeps tiny positive prices nonzero and market cap first, with honest monitor baseline', () => {
 const text=renderReadiness(token,assessReadiness(market({priceUsd:0.000000000123456}),token,now));
 assert.match(text,/Price <b>\$0.000000000123456/);
 assert.ok(text.indexOf('MC <b>')<text.indexOf('Price <b>'));
 assert.match(text,/not your entry price/);
 assert.ok(text.length<4096);
 const observedAt=now-10000;
 assert.match(renderDeterioration({...row,observedAt},market({priceUsd:.8}),1),new RegExp(new Date(observedAt).toISOString().slice(11,19)));
});

test('readiness does not print non-finite provider numbers or unbounded project metadata', () => {
 const text=renderReadiness(token,assessReadiness(market({marketCapUsd:Infinity,fdvUsd:NaN,buys5m:NaN,
   name:'x'.repeat(10000),symbol:'z'.repeat(10000)}),token,now));
 assert.doesNotMatch(text,/Infinity|NaN/);assert.ok(text.length<4096);
});
