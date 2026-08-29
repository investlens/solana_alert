import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAlertComparison, type AlertComparison } from '../src/services/alertComparisonService.js';
import { buildAlphaOutcomeCheckpoint } from '../src/services/alphaAlertOutcomeCheckpoints.js';
import { compareVerifiedPrices } from '../src/services/priceComparability.js';
import { evaluateProAlertNotification } from '../src/services/proAlertNotificationGovernor.js';
import { renderAlphaNotification } from '../src/ui/alphaNotification.js';
import { buildPremiumTokenNotification } from '../src/ui/premiumTokenNotification.js';

const minute = 60_000;
const repeat = (overrides: Partial<AlertComparison> = {}): AlertComparison => ({
  hasPriorAlert: true, historyStatus: 'AVAILABLE', elapsedSincePriorMs: 11 * minute,
  previousState: 'CONFIRMED', currentState: 'CONFIRMED', ...overrides,
});
const metric = (changePct: number, previous = 100) => ({ previous, current: previous * (1 + changePct / 100), changePct });

test('first qualified actionable event remains an Entry without a new progression threshold', () => {
  assert.deepEqual(evaluateProAlertNotification({ hasPriorAlert: false, historyStatus: 'AVAILABLE' }).intent, 'ENTRY');
  for (const drawdownFromPriorStructuralPricePct of [-58, -59, -70]) {
    assert.equal(evaluateProAlertNotification({ hasPriorAlert: false, historyStatus: 'AVAILABLE',
      drawdownFromPriorStructuralPricePct }).intent, 'ENTRY');
  }
  assert.equal(evaluateProAlertNotification({ hasPriorAlert: false, historyStatus: 'AVAILABLE',
    drawdownFromPriorStructuralPricePct: -85 }).intent, 'INTERNAL');
});

test('2-minute and 9-minute lifecycle transitions remain internal', () => {
  for (const elapsedSincePriorMs of [2 * minute, 9 * minute]) {
    assert.equal(evaluateProAlertNotification(repeat({ elapsedSincePriorMs, price: metric(50) })).notify, false);
  }
});

test('cooldown expiry alone and weak +1%/+5% progression do not notify', () => {
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(1) })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(5) })).intent, 'INTERNAL');
});

test('comparable verified progression at or above 10% produces Momentum Update', () => {
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(10) })).intent, 'MOMENTUM_UPDATE');
});

test('alternative Momentum requires +5% progression, two supports, and volume or participation', () => {
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(4.99), volume5m: metric(60), liquidity: metric(20),
    previousState: 'CONFIRMED', currentState: 'RUNNER' })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(5), volume5m: metric(60) })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(5),
    participation: { previousBuys: 2, currentBuys: 4, currentSells: 1 } })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(5), liquidity: metric(20),
    previousState: 'CONFIRMED', currentState: 'RUNNER' })).intent, 'INTERNAL');
  const decision = evaluateProAlertNotification(repeat({ price: metric(5), volume5m: metric(60),
    previousState: 'CONFIRMED', currentState: 'RUNNER' }));
  assert.equal(decision.intent, 'MOMENTUM_UPDATE');
  assert.deepEqual(decision.factors, ['PROGRESSION', 'VOLUME_ACCELERATION', 'STRUCTURAL_CONFIRMATION']);
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(5), participation: { previousBuys: 2, currentBuys: 4, currentSells: 1 },
    previousState: 'CONFIRMED', currentState: 'RUNNER' })).intent, 'MOMENTUM_UPDATE');
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(5), volume5m: metric(60), liquidity: metric(20) })).intent, 'MOMENTUM_UPDATE');
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(5), volume5m: metric(60), liquidity: metric(1) })).intent, 'INTERNAL');
});

test('price and market cap are one progression family', () => {
  const decision = evaluateProAlertNotification(repeat({ price: metric(5), marketCap: metric(20) }));
  assert.equal(decision.intent, 'INTERNAL');
  assert.deepEqual(decision.factors, ['PROGRESSION']);
});

test('raw volume, observation count, one buy, or lifecycle transition alone cannot produce Momentum', () => {
  assert.equal(evaluateProAlertNotification(repeat({ volume5m: metric(900) })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({})).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ participation: { previousBuys: 0, currentBuys: 1, currentSells: 0 } })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ previousState: 'CONFIRMED', currentState: 'RUNNER' })).intent, 'INTERNAL');
});

test('reserved/failed and informational history do not establish an actionable baseline', () => {
  for (const ignoredPrior of ['RESERVED', 'FAILED', 'BOOST']) {
    const decision = evaluateProAlertNotification({ hasPriorAlert: false, historyStatus: 'AVAILABLE' });
    assert.equal(decision.intent, 'ENTRY', ignoredPrior);
  }
});

test('49% drawdown does not trigger damaged structure guard', () => {
  assert.equal(evaluateProAlertNotification(repeat({ drawdownFromPriorStructuralPricePct: -49, price: metric(10) })).intent, 'MOMENTUM_UPDATE');
});

test('at least 50% damaged repeats remain internal regardless of factor strength', () => {
  assert.equal(evaluateProAlertNotification(repeat({ drawdownFromPriorStructuralPricePct: -50, price: metric(1) })).intent, 'INTERNAL');
  for (const evidence of [
    { volume5m: metric(10_000) },
    { participation: { previousBuys: 2, currentBuys: 20, currentSells: 1 } },
    { price: metric(18), volume5m: metric(300), participation: { previousBuys: 2, currentBuys: 20, currentSells: 1 }, liquidity: metric(30) },
  ]) assert.equal(evaluateProAlertNotification(repeat({ drawdownFromPriorStructuralPricePct: -50, ...evidence })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ drawdownFromPriorStructuralPricePct: -49, price: metric(10) })).intent, 'MOMENTUM_UPDATE');
});

test('at least 85% drawdown suppresses simple bounce, one buy, and raw volume', () => {
  assert.equal(evaluateProAlertNotification(repeat({ drawdownFromPriorStructuralPricePct: -85, price: metric(10) })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ drawdownFromPriorStructuralPricePct: -90,
    participation: { previousBuys: 0, currentBuys: 1, currentSells: 0 } })).intent, 'INTERNAL');
  assert.equal(evaluateProAlertNotification(repeat({ drawdownFromPriorStructuralPricePct: -90, volume5m: metric(1000) })).intent, 'INTERNAL');
});

test('unknown drawdown does not fabricate severe damage and no drawdown creates RUG/EXIT', () => {
  assert.equal(evaluateProAlertNotification(repeat({ price: metric(12) })).intent, 'MOMENTUM_UPDATE');
  assert.ok(!['RUG', 'EXIT'].includes(evaluateProAlertNotification(repeat({ drawdownFromPriorStructuralPricePct: -95 })).intent));
});

test('negative, zero, and sub-5% progression remain internal regardless of supporting factors', () => {
  for (const changePct of [-19.12, 0, 1, 4.99]) {
    const decision = evaluateProAlertNotification(repeat({ price: metric(changePct), volume5m: metric(100), liquidity: metric(30),
      participation: { previousBuys: 2, currentBuys: 20, currentSells: 1 }, previousState: 'CONFIRMED', currentState: 'RUNNER' }));
    assert.equal(decision.intent, 'INTERNAL', String(changePct));
  }
});

test('DEX Paid and Boost remain informational WATCH with event-specific presentation', () => {
  const dex = renderAlphaNotification({ category: 'market', severity: 'watch', state: 'DEX_PAID', symbol: 'X', displayIntent: 'WATCH',
    structureContext: 'Structure: severe drawdown from prior verified level' });
  const boost = renderAlphaNotification({ category: 'market', severity: 'watch', state: 'BOOST', symbol: 'X', displayIntent: 'WATCH' });
  const major = renderAlphaNotification({ category: 'market', severity: 'watch', state: 'MAJOR_BOOST', symbol: 'X', displayIntent: 'WATCH' });
  assert.match(dex, /^💎 <b>DEX PAID<\/b>/); assert.match(dex, /ACTION: WATCH/); assert.match(dex, /severe drawdown/);
  assert.match(boost, /^🚀 <b>BOOST DETECTED<\/b>/); assert.match(major, /^🔥🚀 <b>MAJOR BOOST<\/b>/);
  assert.doesNotMatch(`${dex}${boost}${major}`, /CHECK ENTRY|ACTION: MOMENTUM/);
});

test('verified developer values render on one compact line with observed-history language', () => {
  const message = buildPremiumTokenNotification({ state: 'OPPORTUNITY', symbol: 'DEV', address: '0xabc',
    market: { symbol: 'DEV', name: null, address: '0xabc', price: null, marketCap: null, fdv: null, liquidity: null, volume5m: null, chartUrl: null },
    evidence: { devHoldingPercent: 7.8, devHoldingEvidence: 'VERIFIED', burnedPercent: 20, burnEvidence: 'VERIFIED' },
    devBurnPercent: 3.2, devLaunches: 4, insightTitle: 'WHY NOW', insight: ['Verified'], statusTitle: 'STATUS', status: 'Qualified' });
  assert.match(message, /Dev:<\/b> Holds 7\.8% · Burned 3\.2% · 4 observed launches/);
  assert.doesNotMatch(message, /lifetime|prior launches|Dev: Unknown/i);
});

test('unverified/default developer zeros are omitted and transfer is never rendered as sell', () => {
  const message = buildPremiumTokenNotification({ state: 'BOOST', symbol: 'DEV', address: '0xabc',
    market: { symbol: 'DEV', name: null, address: '0xabc', price: null, marketCap: null, fdv: null, liquidity: null, volume5m: null, chartUrl: null },
    evidence: { devHoldingPercent: 0, devHoldingEvidence: 'UNCONFIRMED', burnedPercent: 0, burnEvidence: 'UNCONFIRMED' },
    devLaunches: 0, insightTitle: 'EVENT', insight: [], statusTitle: 'STATUS', status: 'Watch' });
  assert.doesNotMatch(message, /Dev:|sell/i);
});

test('same verified indexed provenance is comparable and NULL remains unavailable', () => {
  const comparable = compareVerifiedPrices(
    { chain: 'robinhood', token: '0xAbC', price: 1, provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', marketIndexState: 'VERIFIED' },
    { chain: 'ROBINHOOD', token: '0xabc', price: 1.1, provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', marketIndexState: 'VERIFIED' });
  assert.equal(comparable.comparable, true);
  assert.equal(compareVerifiedPrices({ chain: 'x', token: 'a', price: null, provenance: 'DEX_BASE_V1' },
    { chain: 'x', token: 'a', price: 1, provenance: 'DEX_BASE_V1' }).comparable, false);
});

test('curve/index prices are incomparable and cannot create fake momentum or drawdown', () => {
  const previous = { id: 1, alerted_at: '2026-08-29T10:00:00Z', asset_id: '0xabc', chain: 'robinhood',
    semantic_event_type: 'OPPORTUNITY', price: 0.000001, price_provenance: 'PONS_V2_CURVE_RESERVE_RATIO', market_index_state: 'NOT_INDEXED' };
  const current = { ...previous, id: 2, alerted_at: '2026-08-29T10:11:00Z', price: 20,
    price_provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', market_index_state: 'VERIFIED' };
  const comparison = buildAlertComparison(previous, current);
  assert.equal(comparison.price, undefined);
  assert.equal(evaluateProAlertNotification(comparison).intent, 'INTERNAL');
});

test('incomparable checkpoint prices are quarantined instead of producing absurd ROI', () => {
  const row = buildAlphaOutcomeCheckpoint({ event: { id: 20517, asset_id: '0xubi', chain: 'robinhood', price: 0.0000067,
    price_provenance: 'PONS_V2_CURVE_RESERVE_RATIO', market_index_state: 'NOT_INDEXED', alerted_at: '2026-08-29T10:00:00Z' },
    checkpointSeconds: 60, currentPrice: 26.32, source: 'ROBINHOOD_MARKET_SNAPSHOT', provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', prior: [] });
  assert.equal(row.status, 'UNAVAILABLE'); assert.equal(row.current_roi, null);
  assert.equal(row.completeness.reason, 'CURVE_INDEX_PROVENANCE_MISMATCH');
});

test('representative audited replay assigns meaningful continuations and suppresses noise', () => {
  const replay = [
    ['HOTDOG first', { hasPriorAlert: false, historyStatus: 'AVAILABLE' }],
    ['9TO5 material', repeat({ price: metric(17.25) })], ['RYZEN +20.93', repeat({ price: metric(20.93) })],
    ['RYZEN 0', repeat({ price: metric(0) })], ['RYZEN +0.53', repeat({ price: metric(0.53) })],
    ['SEMI 0', repeat({ price: metric(0) })], ['TV +0.14', repeat({ price: metric(0.14) })],
    ['GIWA 0', repeat({ price: metric(0) })], ['WIF +35.1', repeat({ price: metric(35.1) })],
    ['WIF +1.05', repeat({ price: metric(1.05) })], ['FINCH +0.92', repeat({ price: metric(0.92) })],
    ['Beni -89', repeat({ drawdownFromPriorStructuralPricePct: -89, price: metric(1) })],
    ['BORG -92', repeat({ drawdownFromPriorStructuralPricePct: -92, price: metric(1) })],
    ['DON -50 raw volume', repeat({ drawdownFromPriorStructuralPricePct: -50, volume5m: metric(15_800) })],
  ] as const;
  const decisions = new Map<string, string>(replay.map(([name, comparison]) => [name, evaluateProAlertNotification(comparison as AlertComparison).intent]));
  assert.equal(decisions.get('HOTDOG first'), 'ENTRY'); assert.equal(decisions.get('9TO5 material'), 'MOMENTUM_UPDATE');
  assert.equal(decisions.get('RYZEN +20.93'), 'MOMENTUM_UPDATE'); assert.equal(decisions.get('WIF +35.1'), 'MOMENTUM_UPDATE');
  for (const name of ['RYZEN 0', 'RYZEN +0.53', 'SEMI 0', 'TV +0.14', 'GIWA 0', 'WIF +1.05', 'FINCH +0.92', 'Beni -89', 'BORG -92', 'DON -50 raw volume']) {
    assert.equal(decisions.get(name), 'INTERNAL', name);
  }
});
