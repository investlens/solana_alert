import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildAlertComparison, compareVerifiedMetric, renderMomentumUpdate } from '../src/services/alertComparisonService.js';
import type { TokenIntel } from '../src/services/tokenIntelligenceService.js';
import { renderAlphaNotification } from '../src/ui/alphaNotification.js';
import { buildAlphaMarketActions } from '../src/ui/alphaNotificationActions.js';
import { renderTokenIntelligence } from '../src/ui/tokenIntelligenceView.js';

test('standard automatic alert is compact, decision-oriented and contains no raw internals', () => {
  const message = renderAlphaNotification({ category: 'market', severity: 'watch', state: 'RUNNER', subtitle: 'Time Vault', symbol: 'TV',
    address: '0xEAe2000000000000000000000000000000008bcc', risk: 'UNKNOWN', metrics: [
      { label: 'Price', value: '$0.00003541' }, { label: 'Market cap', value: '$34.7K' },
      { label: 'Liquidity', value: '$18.3K' }, { label: '5m volume', value: '$118.5' },
    ], insightTitle: 'WHY NOW', insight: ['New ATH reached', 'Momentum strengthening', 'Liquidity remains healthy', 'ignored fourth insight'] });
  assert.ok(message.length <= 1200); assert.ok(message.split('\n').length <= 14);
  assert.match(message, /RUNNER — Time Vault \(\$TV\)/); assert.match(message, /\$0\.00003541/);
  assert.match(message, /Market cap <b>\$34\.7K/); assert.match(message, /Liquidity <b>\$18\.3K/); assert.match(message, /5m volume <b>\$118\.5/);
  assert.equal((message.match(/^• /gm) ?? []).length, 3); assert.doesNotMatch(message, /DEXSCREENER_VERIFIED|2026-\d\d-/);
});

test('Time Vault comparison produces the expected qualified momentum update only when explicitly rendered', () => {
  const previous = { id: 1, alerted_at: '2026-08-29T10:40:00Z', asset_id: '0xEAe2000000000000000000000000000000008bcc', symbol: 'TV', token_name: 'Time Vault',
    semantic_event_type: 'OPPORTUNITY', intelligence_state: 'RUNNER', price: 0.00003541, price_provenance: 'VERIFIED', market_cap: 34700, liquidity: 18300, volume_5m: 118.5 };
  const current = { ...previous, id: 2, alerted_at: '2026-08-29T10:49:00Z', price: 0.00004173, market_cap: 40800, liquidity: 19200, volume_5m: 256.3 };
  const comparison = buildAlertComparison(previous, current);
  assert.equal(comparison.price?.changePct.toFixed(1), '17.8');
  assert.equal(comparison.marketCap?.changePct.toFixed(1), '17.6');
  assert.equal(comparison.liquidity?.changePct.toFixed(1), '4.9');
  assert.equal(comparison.volume5m?.changePct.toFixed(1), '116.3');
  const update = renderMomentumUpdate(comparison)!;
  assert.match(update, /MOMENTUM UPDATE/); assert.match(update, /Price <b>\+17\.8%<\/b> since AlphaOS alert/);
  assert.doesNotMatch(update, /💧 Liq/); assert.match(update, /Vol 5m[\s\S]*116\.3%/);
  assert.equal(compareVerifiedMetric(0, 2), undefined); assert.equal(compareVerifiedMetric(null, 2), undefined);
  assert.equal(renderMomentumUpdate({ hasPriorAlert: false }), null);
});

test('non-positive current events can never inherit the momentum presentation', () => {
  const previous = { id: 1, alerted_at: '2026-08-29T10:40:00Z', semantic_event_type: 'OPPORTUNITY', price: 0.000041, price_provenance: 'DEXSCREENER' };
  const current = { id: 2, alerted_at: '2026-08-29T10:49:00Z', semantic_event_type: 'RISK', price: 0.000049, price_provenance: 'DEXSCREENER' };
  const comparison = buildAlertComparison(previous, current);
  assert.equal(comparison.hasPriorAlert, false);
  assert.equal(renderMomentumUpdate(comparison), null);
});

test('prior comparison architecture selects delivered rows and excludes reserved-only history', async () => {
  const source = await readFile('src/services/alertComparisonService.ts', 'utf8');
  assert.match(source, /alpha_alert_event_deliveries/); assert.match(source, /not\('delivered_at', 'is', null\)/);
  assert.doesNotMatch(source, /deliverAlphaSemanticEvent|sendTelegram/);
});

test('Full Intel groups unavailable evidence and humanizes time and provenance', () => {
  const intel: TokenIntel = { status: 'PARTIAL', analyzedAt: new Date().toISOString(), chain: 'robinhood',
    tokenAddress: '0xEAe2000000000000000000000000000000008bcc', name: 'Time Vault', symbol: 'TV', decimals: 18,
    supply: '1000000000000000000000000000', ageObservedAt: null, price: 0.00003541, marketCap: 34700, liquidity: 18300,
    volume5m: 118.5, chartUrl: 'https://dexscreener.com/robinhood/pair', marketObservedAt: new Date().toISOString(), lastVerifiedMarket: null,
    ath: { priceUsd: 0.00003541, marketCapUsd: 34700, priceObservedAt: new Date().toISOString(), marketCapObservedAt: null,
      priceSource: 'DEXSCREENER_VERIFIED_BASE_PAIR', marketCapSource: null, distanceFromPricePct: 0, distanceFromMarketCapPct: 0 },
    holders: { count: null, top10Pct: null, largestPct: null, risk: 'UNKNOWN', warnings: ['Blockscout holders HTTP 403'] },
    freshWallets: { oneDayPct: null, verifiedFresh: 0, notFresh: 0, unknown: 0, classified: 0, coveragePct: null, sampleSize: 0, evidence: 'UNKNOWN', methodology: 'verified nonce history' },
    developer: { wallet: null, holdingPct: null, sold: null, transferredPct: null, burnedPct: null },
    devHistory: { launches: 0, measuredSuccessful: 0, weakOrFailed: 0, verdict: 'Creator history unavailable.', risks: [] },
    security: { tokenBurnedPct: null, lpStatus: 'UNKNOWN', dexPaid: null, boostTotal: 100 },
    alpha: { state: 'RUNNER', risk: 'UNKNOWN', positive: [], watch: [], verdict: 'Momentum strengthening.' }, socials: [],
    incompleteReason: 'Blockscout holders HTTP 403' };
  const message = renderTokenIntelligence(intel);
  assert.ok(message.length < 2500); assert.match(message, /FULL INTEL/); assert.match(message, /State\s+<b>RUNNER/);
  assert.match(message, /Supply\s+<b>1,000,000,000/); assert.match(message, /ATH source\s+<b>DexScreener/);
  assert.doesNotMatch(message, /Blockscout holders HTTP 403/);
  assert.deepEqual(intel.holders.warnings, ['Blockscout holders HTTP 403']);
  assert.match(message, /HOLDERS &amp; FRESH WALLETS[\s\S]*Analysis currently unavailable/);
  assert.doesNotMatch(message, /DEXSCREENER_VERIFIED_BASE_PAIR|2026-\d\d-\d\dT/);
  assert.equal((message.match(/👨‍💻 <b>DEVELOPER<\/b>/g) ?? []).length, 1);
  assert.doesNotMatch(message, /DEV HISTORY/);
  assert.match(message, /No verified developer history available/);
});

test('Internet Money Full Intel stays compact without hiding verified security evidence', () => {
  const now = '2026-08-29T12:00:00.000Z';
  const intel: TokenIntel = { status: 'PARTIAL', analyzedAt: now, chain: 'robinhood',
    tokenAddress: '0x41e3000000000000000000000000000000008d41', name: 'Internet Money', symbol: 'INTERNETMONEY',
    decimals: 18, supply: '1000000000000000000000000000', ageObservedAt: null, price: 0.000004139,
    marketCap: 4139, liquidity: 3170, volume5m: 0, chartUrl: 'https://dexscreener.com/robinhood/internetmoney',
    marketObservedAt: now, lastVerifiedMarket: null,
    ath: { priceUsd: 0.000004139, marketCapUsd: 4139, priceObservedAt: now, marketCapObservedAt: now,
      priceSource: 'DEXSCREENER_VERIFIED_BASE_PAIR', marketCapSource: 'DEXSCREENER_VERIFIED_BASE_PAIR',
      distanceFromPricePct: 0, distanceFromMarketCapPct: 0 },
    holders: { count: null, top10Pct: null, largestPct: null, risk: 'UNKNOWN', warnings: ['Blockscout holders HTTP 403'] },
    freshWallets: { oneDayPct: null, verifiedFresh: 0, notFresh: 0, unknown: 0, classified: 0,
      coveragePct: null, sampleSize: 0, evidence: 'UNKNOWN', methodology: 'verified nonce history' },
    developer: { wallet: null, holdingPct: null, sold: null, transferredPct: null, burnedPct: null },
    devHistory: { launches: 0, measuredSuccessful: 0, weakOrFailed: 0, verdict: 'Creator history unavailable.', risks: [] },
    security: { tokenBurnedPct: null, lpStatus: 'UNKNOWN', dexPaid: null, boostTotal: 30 }, socials: [],
    alpha: { state: 'BUILDING', risk: 'UNKNOWN', verdict: 'Showing verified data collected within the analysis budget.', positive: [], watch: [] },
    incompleteReason: 'Blockscout holders HTTP 403' };
  const message = renderTokenIntelligence(intel);
  assert.ok(message.length < 1800); assert.ok(message.length <= 4096);
  assert.match(message, /Volume \(5m\)\s+<b>\$0<\/b>/); assert.match(message, /Boost total\s+<b>30<\/b>/);
  assert.match(message, /View\s+Momentum is building\./);
  assert.doesNotMatch(message, /HTTP 403|Showing verified data collected|DEV HISTORY/);
});

test('automatic action hierarchy remains callback-safe and does not add Trade', () => {
  const rows = buildAlphaMarketActions({ chartUrl: 'https://dexscreener.com/x', tokenUrl: 'https://explorer/x',
    fullIntelCallback: 'FI_RH_0x123', trackCallback: 'TRACK_1', copyContractCallback: 'COPY_CA_1', muteCallback: 'MUTE_1' });
  assert.deepEqual(rows.map(row => row.map(button => button.text)), [['🔬 Full Intel', '📊 Chart'], ['⭐ Track', '📋 Copy CA'], ['🔕 Mute']]);
  assert.ok(rows.flat().every(button => !button.callback_data || Buffer.byteLength(button.callback_data) <= 64));
  assert.ok(rows.flat().every(button => !/Trade/i.test(button.text)));
});

const intentOpportunity = (rawData: Record<string, unknown>) => ({ id: 42,
  asset_id: '0xf435ac1926e21d47bfe0916bd1f15c22ca6ceb4b', chain: 'robinhood',
  strategy_key: 'EXISTING_TOKEN_BREAKOUT', recommended_action: 'CHECK_ENTRY', status: 'NEW',
  title: 'HOTDOG Existing Token Breakout', why: 'Breakout confirmed. Volume acceleration increased. Structure remains confirmed. Fourth reason is bounded.',
  what_happened: null, invalidation: null, risk_reason: null, confidence: 72, risk_score: 42,
  raw_data: { symbol: 'HOTDOG', price: 0.00004952, marketCap: 49_527, liquidity: 18_380,
    currentRoi: 12.75, elapsedSec: 2233, ...rawData } });

test('first actionable CHECK_ENTRY is explicit entry intent and bounded to three reasons', async () => {
  await import('dotenv/config');
  const { buildOpportunityMessage } = await import('../src/services/opportunityDeliveryService.js');
  const message = buildOpportunityMessage(intentOpportunity({}));
  assert.match(message, /^🎯 <b>ENTRY OPPORTUNITY<\/b>/);
  assert.match(message, /🎯 <b>ACTION: CHECK ENTRY<\/b>/);
  assert.match(message, /Conditions qualify for entry consideration/);
  assert.doesNotMatch(message, /Previously alerted opportunity has a new qualified momentum signal/);
  assert.equal((message.match(/^• /gm) ?? []).length, 3);
  assert.match(message, /• Breakout confirmed\n• Volume acceleration increased\n• Structure remains confirmed/);
  assert.ok(message.length <= 4096);
});

test('prior successfully delivered actionable event produces momentum intent with verified comparison only', async () => {
  await import('dotenv/config');
  const { buildOpportunityMessage } = await import('../src/services/opportunityDeliveryService.js');
  const base = intentOpportunity({});
  const message = buildOpportunityMessage(base, { hasPriorAlert: true,
    price: { previous: 0.00004, current: 0.00004952, changePct: 23.8 }, previousState: 'CONFIRMED', currentState: 'RUNNER' });
  assert.match(message, /^📈 <b>MOMENTUM UPDATE<\/b>/);
  assert.match(message, /📈 <b>ACTION: MOMENTUM UPDATE<\/b>/);
  assert.match(message, /Previously alerted opportunity has a new qualified momentum signal/);
  assert.match(message, /Previously alerted[\s\S]*Now[\s\S]*Change[\s\S]*\+23\.8%/);
  assert.match(message, /This is an update to an earlier opportunity/);
  const unavailable = buildOpportunityMessage(base, { hasPriorAlert: true });
  assert.doesNotMatch(unavailable, /Previously alerted\s+<b>\$0/);
});

test('reason formatting renders one verified reason once and never more than three bullets', () => {
  const one = renderAlphaNotification({ category: 'market', severity: 'watch', state: 'BOOST', symbol: 'ONE',
    displayIntent: 'WATCH', insight: ['One verified reason.'] });
  assert.equal((one.match(/^• /gm) ?? []).length, 1); assert.match(one, /• One verified reason/);
  const four = renderAlphaNotification({ category: 'market', severity: 'watch', state: 'BOOST', symbol: 'FOUR',
    displayIntent: 'WATCH', insight: ['First. Second. Third. Fourth.'] });
  assert.equal((four.match(/^• /gm) ?? []).length, 3); assert.doesNotMatch(four, /Fourth/);
});

test('informational, avoid and exit display intents remain unambiguous', () => {
  const watch = renderAlphaNotification({ category: 'market', severity: 'watch', state: 'BOOST', symbol: 'HOTDOG', displayIntent: 'WATCH' });
  assert.match(watch, /MARKET UPDATE[\s\S]*ACTION: WATCH[\s\S]*Information only — entry not confirmed/);
  assert.doesNotMatch(watch, /CHECK ENTRY|ACTION: BUY/);
  assert.match(renderAlphaNotification({ category: 'risk', severity: 'critical', state: 'RISK', symbol: 'HOTDOG', displayIntent: 'AVOID' }), /ACTION: AVOID/);
  assert.match(renderAlphaNotification({ category: 'risk', severity: 'critical', state: 'EXIT_AVOID', symbol: 'HOTDOG', displayIntent: 'EXIT' }), /ACTION: EXIT/);
});

test('automatic social links are allowlisted, deduplicated and optional without changing callbacks', async () => {
  await import('dotenv/config');
  const { automaticAlertSocials } = await import('../src/services/opportunityDeliveryService.js');
  assert.deepEqual(automaticAlertSocials({ xUrl: 'https://x.com/hotdog', socials: [
    { type: 'twitter', url: 'https://twitter.com/hotdog' }, { type: 'telegram', url: 'https://t.me/hotdog' },
    { type: 'telegram', url: 'https://telegram.me/hotdog' }, { url: 'javascript:alert(1)' },
  ] }), { xUrl: 'https://x.com/hotdog', telegramUrl: 'https://t.me/hotdog' });
  assert.deepEqual(automaticAlertSocials({ xUrl: 'http://x.com/bad', telegramUrl: 'data:text/html,bad' }), { xUrl: null, telegramUrl: null });
  const rows = buildAlphaMarketActions({ tokenUrl: 'https://example.com/token', fullIntelCallback: 'FI_RH_0x123',
    xUrl: 'https://twitter.com/hotdog', telegramUrl: 'https://t.me/hotdog', trackCallback: 'TRACK_1',
    copyContractCallback: 'COPY_CA_1', muteCallback: 'MUTE_1' });
  assert.deepEqual(rows.map(row => row.map(button => button.text)), [
    ['🔬 Full Intel'], ['𝕏 X', '✈️ Telegram'], ['⭐ Track', '📋 Copy CA'], ['🔕 Mute'],
  ]);
  assert.equal(rows.flat().filter(button => button.text === '𝕏 X').length, 1);
  assert.equal(rows.flat().filter(button => button.text === '✈️ Telegram').length, 1);
  const one = buildAlphaMarketActions({ tokenUrl: 'https://example.com/token', fullIntelCallback: 'FI_RH_0x123',
    xUrl: 'https://x.com/hotdog', trackCallback: 'TRACK_1', copyContractCallback: 'COPY_CA_1', muteCallback: 'MUTE_1' });
  assert.deepEqual(one.map(row => row.map(button => button.text)), [
    ['🔬 Full Intel'], ['𝕏 X'], ['⭐ Track', '📋 Copy CA'], ['🔕 Mute'],
  ]);
  const none = buildAlphaMarketActions({ tokenUrl: 'https://example.com/token', fullIntelCallback: 'FI_RH_0x123',
    trackCallback: 'TRACK_1', copyContractCallback: 'COPY_CA_1', muteCallback: 'MUTE_1' });
  assert.deepEqual(none.map(row => row.map(button => button.text)), [
    ['🔬 Full Intel'], ['⭐ Track', '📋 Copy CA'], ['🔕 Mute'],
  ]);
  const noIntel = buildAlphaMarketActions({ tokenUrl: 'https://example.com/token', chartUrl: 'https://example.com/chart' });
  assert.deepEqual(noIntel.map(row => row.map(button => button.text)), [['📊 Chart'], ['🔎 Token']]);
  assert.equal(rows.flat().find(button => button.text === '🔬 Full Intel')?.callback_data, 'FI_RH_0x123');
  assert.equal(rows.flat().find(button => button.text === '📋 Copy CA')?.callback_data, 'COPY_CA_1');
});

test('comparison source requires actionable semantics and checks both successful delivery ledgers', async () => {
  const source = await readFile('src/services/alertComparisonService.ts', 'utf8');
  assert.match(source, /ACTIONABLE_TYPES/); assert.match(source, /opportunity_deliveries/);
  assert.doesNotMatch(source, /ACTIONABLE_TYPES = new Set\([^)]*BOOST/s);
});
