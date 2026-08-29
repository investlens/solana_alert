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
  assert.equal((message.match(/Blockscout holders HTTP 403/g) ?? []).length, 1);
  assert.doesNotMatch(message, /DEXSCREENER_VERIFIED_BASE_PAIR|2026-\d\d-\d\dT/);
  assert.match(message, /No verified developer data available/);
});

test('automatic action hierarchy remains callback-safe and does not add Trade', () => {
  const rows = buildAlphaMarketActions({ chartUrl: 'https://dexscreener.com/x', tokenUrl: 'https://explorer/x',
    fullIntelCallback: 'FI_RH_0x123', trackCallback: 'TRACK_1', copyContractCallback: 'COPY_CA_1', muteCallback: 'MUTE_1' });
  assert.deepEqual(rows.map(row => row.map(button => button.text)), [['🔬 Full Intel', '📊 Chart'], ['⭐ Track', '📋 Copy CA'], ['🔕 Mute'], ['🔎 Token']]);
  assert.ok(rows.flat().every(button => !button.callback_data || Buffer.byteLength(button.callback_data) <= 64));
  assert.ok(rows.flat().every(button => !/Trade/i.test(button.text)));
});
