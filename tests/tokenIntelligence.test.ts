import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildAlphaMarketActions } from '../src/ui/alphaNotificationActions.js';
import { qualifyPremiumOpportunity } from '../src/services/opportunityDeliveryService.js';
import { freshWalletBlockPersistence, freshWalletEvidenceFromStates, freshWalletRiskBlocksPositive,
  mergeTokenAth, tokenIntelligenceCacheIsReusable, validateProjectSocial, type TokenIntel } from '../src/services/tokenIntelligenceService.js';
import { normalizedTokenSupply, renderTokenIntelligence, tokenIntelligenceButtons } from '../src/ui/tokenIntelligenceView.js';

function fixture(overrides: Partial<TokenIntel> = {}): TokenIntel {
  return { status: 'COMPLETE', analyzedAt: '2026-08-28T12:00:00.000Z', chain: 'robinhood',
    tokenAddress: '0x5571E3b04487438847566a54B59b940e6668A8c6', name: 'Stonk <ATM>', symbol: 'STONKATM',
    decimals: 18, supply: '1000000000000000000000000', ageObservedAt: '2026-08-20T00:00:00.000Z',
    price: 0.01, marketCap: 43_650, liquidity: 12_000, volume5m: 8_000, chartUrl: 'https://dexscreener.com/robinhood/abc',
    ath: { priceUsd: 0.013, priceObservedAt: '2026-08-27T00:00:00.000Z', priceSource: 'ALPHAOS_VERIFIED_OBSERVATION',
      marketCapUsd: 56_700, marketCapObservedAt: '2026-08-27T00:05:00.000Z', marketCapSource: 'ALPHAOS_VERIFIED_OBSERVATION',
      distanceFromPricePct: -23.07, distanceFromMarketCapPct: -23.015873 },
    holders: { count: 44, top10Pct: 31, largestPct: 8, risk: 'MEDIUM', warnings: ['Elevated concentration'] },
    freshWallets: { oneDayPct: 64.705, verifiedFresh: 11, notFresh: 6, unknown: 3, classified: 17,
      coveragePct: 85, sampleSize: 20,
      evidence: 'VERIFIED', methodology: 'verified nonce history' },
    developer: { wallet: '0xf435ac1926e21d47bfe0916bd1f15c22ca6ceb4b', holdingPct: 2.5,
      sold: false, transferredPct: 4.2, burnedPct: 1.1 },
    devHistory: { launches: 5, measuredSuccessful: 2, weakOrFailed: 3,
      verdict: 'Negative launch-history evidence.', risks: ['More than 3 launches tracked'] },
    security: { tokenBurnedPct: 4.2, lpStatus: 'UNKNOWN', dexPaid: true, boostTotal: 500 },
    socials: [{ label: 'X', url: 'https://x.com/stonkatm' }, { label: 'Website', url: 'https://stonk.example/' }],
    alpha: { state: 'BUILDING', risk: 'HIGH', verdict: 'Watch verified concentration.',
      positive: ['DEX Paid verified'], watch: ['Fresh-wallet concentration'] }, ...overrides };
}

test('Full Intel action is callback-safe and does not introduce Trade', () => {
  const rows = buildAlphaMarketActions({ chartUrl: 'https://dexscreener.com/robinhood/abc',
    tokenUrl: 'https://robinhoodchain.blockscout.com/token/0x5571E3b04487438847566a54B59b940e6668A8c6',
    copyContractCallback: 'COPY_CA_0x5571E3b04487438847566a54B59b940e6668A8c6',
    fullIntelCallback: 'FI_RH_0x5571E3b04487438847566a54B59b940e6668A8c6' });
  const flat = rows.flat();
  assert(flat.some(x => x.text === '🔬 Full Intel'));
  assert(flat.every(x => !('callback_data' in x) || Buffer.byteLength(x.callback_data!, 'utf8') <= 64));
  assert(!flat.some(x => /Trade/i.test(x.text)));
});

test('BOOST, DEX Paid, opportunity and developer alerts wire Full Intel without synchronous analysis', async () => {
  const sources = await Promise.all(['../src/chains/robinhood/robinhoodBoostObserver.ts',
    '../src/chains/robinhood/robinhoodObserver.ts', '../src/chains/robinhood/security/devPostAlertWatcher.ts',
    '../src/services/opportunityDeliveryService.ts'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) assert.match(source, /FI_RH_/);
  for (const source of sources.slice(0, 3)) assert.doesNotMatch(source, /getRobinhoodTokenIntelligence|analyzeRobinhoodToken/);
});

test('social URLs are allowlisted, clickable, and invalid URLs are suppressed', () => {
  assert.deepEqual(validateProjectSocial('https://x.com/alpha', 'twitter'), { label: 'X', url: 'https://x.com/alpha' });
  assert.deepEqual(validateProjectSocial('https://t.me/alpha', 'telegram'), { label: 'Telegram', url: 'https://t.me/alpha' });
  assert.equal(validateProjectSocial('javascript:alert(1)', 'website'), null);
  assert.equal(validateProjectSocial('http://evil.example', 'website'), null);
  const buttons = tokenIntelligenceButtons(fixture());
  assert(buttons.flat().some(x => x.url === 'https://x.com/stonkatm'));
});

test('Full Intel renders verified developer/history without false sell or scam claims', () => {
  const text = renderTokenIntelligence(fixture());
  assert.match(text, /0xf435…eb4b/);
  assert.match(text, /Verified sold\s+<b>NO<\/b>/);
  assert.match(text, /Transferred\s+<b>4\.2%<\/b>/);
  assert.doesNotMatch(text, /scam/i);
});

test('token burn and LP status remain distinct', () => {
  const text = renderTokenIntelligence(fixture());
  assert.match(text, /Token burned\s+<b>4\.2%<\/b>/);
  assert.match(text, /LP status\s+<b>UNKNOWN<\/b>/);
});

test('verified ATH and distance render; unavailable ATH stays UNKNOWN', () => {
  assert.match(renderTokenIntelligence(fixture()), /23\.0% below ATH/);
  const unknown = fixture({ ath: { priceUsd: null, priceObservedAt: null, priceSource: null, marketCapUsd: null,
    marketCapObservedAt: null, marketCapSource: null, distanceFromPricePct: null, distanceFromMarketCapPct: null } });
  assert.match(renderTokenIntelligence(unknown), /ATH Market Cap\s+<b>UNKNOWN<\/b>/);
  assert.match(renderTokenIntelligence(unknown), /Distance from ATH <b>UNKNOWN<\/b>/);
});

test('TROLL failure shape distinguishes unavailable current market from last verified AlphaOS evidence', () => {
  const troll = fixture({ status: 'PARTIAL', tokenAddress: '0xa206753eb19D8E3F9Ae3313ADb467BdC2a7a4d90',
    name: 'Troll in Hood', symbol: 'TROLL', price: null, marketCap: null, liquidity: null, volume5m: null,
    marketObservedAt: null, lastVerifiedMarket: { price: 0.0001638, marketCap: 161_382, liquidity: 44_757.28,
      volume5m: 141.37, observedAt: '2026-08-28T18:01:48.647Z', source: 'DEXSCREENER_VERIFIED_BASE_PAIR' },
    holders: { count: null, top10Pct: null, largestPct: null, risk: 'UNKNOWN', warnings: ['Blockscout holders HTTP 403'] },
    freshWallets: { oneDayPct: null, verifiedFresh: 0, notFresh: 0, unknown: 0, classified: 0,
      coveragePct: null, sampleSize: 0, evidence: 'UNKNOWN', methodology: 'verified nonce history' } });
  const text = renderTokenIntelligence(troll);
  assert.match(text, /Current market data <b>UNAVAILABLE<\/b>/);
  assert.match(text, /Last verified price <b>\$0\.0001638<\/b>/);
  assert.match(text, /Last verified MC\s+<b>\$161\.4K<\/b>/);
  assert.match(text, /Holder analysis <b>UNAVAILABLE<\/b>/);
  assert.match(text, /Blockscout holders HTTP 403/);
  assert.doesNotMatch(text, /Price\s+<b>\$0<\/b>/);
});

test('live market and holder evidence remain independent in Full Intel presentation', () => {
  const liveWithHolderFailure = fixture({ holders: { count: null, top10Pct: null, largestPct: null,
    risk: 'UNKNOWN', warnings: ['holder provider unavailable'] } });
  assert.match(renderTokenIntelligence(liveWithHolderFailure), /Price\s+<b>\$0\.01000<\/b>/);
  const marketFailureWithHolders = fixture({ price: null, marketCap: null, liquidity: null, volume5m: null,
    lastVerifiedMarket: null });
  const rendered = renderTokenIntelligence(marketFailureWithHolders);
  assert.match(rendered, /Current market data <b>UNAVAILABLE<\/b>/);
  assert.match(rendered, /Observed holders\s+<b>44<\/b>/);
});

test('PARTIAL cache is retryable after one minute while COMPLETE keeps the declared TTL', () => {
  const now = Date.parse('2026-08-29T00:02:00.000Z');
  const partial = fixture({ status: 'PARTIAL', analyzedAt: '2026-08-29T00:00:00.000Z' });
  assert.equal(tokenIntelligenceCacheIsReusable('PARTIAL', partial, '2026-08-29T00:15:00.000Z', now), false);
  assert.equal(tokenIntelligenceCacheIsReusable('PARTIAL', { ...partial, analyzedAt: '2026-08-29T00:01:30.000Z' }, '2026-08-29T00:02:30.000Z', now), true);
  assert.equal(tokenIntelligenceCacheIsReusable('COMPLETE', fixture(), '2026-08-29T00:10:00.000Z', now), true);
});

test('raw token supply is normalized for display without losing stored precision', () => {
  assert.equal(normalizedTokenSupply('1000000000000000000000000000', 18), '1,000,000,000');
  const text = renderTokenIntelligence(fixture({ supply: '1000000000000000000000000000', decimals: 18 }));
  assert.match(text, /Supply\s+<b>1,000,000,000<\/b>/);
  assert.doesNotMatch(text, /1000000000000000000000000000/);
});

test('fresh-wallet threshold is strict, verified-only, and visible', () => {
  assert.equal(freshWalletRiskBlocksPositive({ freshWalletEvidence: 'VERIFIED', freshWallet1dPct: 50 }), false);
  assert.equal(freshWalletRiskBlocksPositive({ freshWalletEvidence: 'VERIFIED', freshWallet1dPct: 50.01 }), true);
  assert.equal(freshWalletRiskBlocksPositive({ freshWalletEvidence: 'UNKNOWN', freshWallet1dPct: 99 }), false);
  assert.match(renderTokenIntelligence(fixture()), /1D verified fresh <b>64\.7%<\/b>/);
  assert.match(renderTokenIntelligence(fixture()), /High fresh-wallet concentration/);
});

test('fresh confidence requires meaningful sample and classified coverage', () => {
  assert.equal(freshWalletEvidenceFromStates(['VERIFIED_FRESH']).evidence, 'INSUFFICIENT');
  assert.equal(freshWalletEvidenceFromStates(['VERIFIED_FRESH', 'VERIFIED_FRESH', 'VERIFIED_FRESH']).evidence, 'INSUFFICIENT');
  const lowCoverage = freshWalletEvidenceFromStates(['VERIFIED_FRESH', 'VERIFIED_FRESH', 'VERIFIED_FRESH',
    'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  assert.equal(lowCoverage.evidence, 'INSUFFICIENT');
  const verified = freshWalletEvidenceFromStates(['VERIFIED_FRESH', 'VERIFIED_FRESH', 'VERIFIED_FRESH',
    'NOT_FRESH', 'NOT_FRESH', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  assert.equal(verified.evidence, 'VERIFIED'); assert.equal(verified.oneDayPct, 60);
  assert.equal(verified.classified, 5); assert.equal(verified.coveragePct, 62.5);
});

test('UNKNOWN is excluded from fresh numerator and classified denominator', () => {
  const evidence = freshWalletEvidenceFromStates(['VERIFIED_FRESH', 'NOT_FRESH', 'UNKNOWN', 'UNKNOWN',
    'VERIFIED_FRESH', 'NOT_FRESH', 'NOT_FRESH', 'UNKNOWN']);
  assert.equal(evidence.classified, 5); assert.equal(evidence.oneDayPct, 40);
});

test('fresh-wallet block persistence contains normalized reason and coverage evidence', () => {
  const evidence = freshWalletEvidenceFromStates(['VERIFIED_FRESH', 'VERIFIED_FRESH', 'VERIFIED_FRESH',
    'NOT_FRESH', 'NOT_FRESH', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  const persisted = freshWalletBlockPersistence(evidence, '2026-08-28T14:32:00.000Z');
  assert.equal(persisted.riskReason, 'HIGH_FRESH_WALLET_CONCENTRATION');
  assert.equal(persisted.evidence.freshWalletSampleSize, 8);
  assert.equal(persisted.evidence.freshWalletClassifiedCount, 5);
  assert.equal(persisted.evidence.freshWalletCoveragePct, 62.5);
  assert.match(renderTokenIntelligence(fixture()), /Coverage\s+<b>17 \/ 20 wallets<\/b>/);
});

test('opportunity block persists normalized risk before returning without a fake alert event', async () => {
  const source = await readFile(new URL('../src/services/opportunityDeliveryService.ts', import.meta.url), 'utf8');
  const block = source.indexOf("risk_reason: persisted.riskReason");
  const returnAt = source.indexOf('return;', block);
  const alertAt = source.indexOf('persistAlphaAlertEvent(opportunity)', block);
  assert(block > 0 && returnAt > block && alertAt > returnAt);
  assert.match(source.slice(block, returnAt), /raw_data: opportunity\.raw_data/);
});

test('ATH is monotonic, includes verified current values, and keeps independent provenance', () => {
  const previous = fixture().ath;
  const lower = mergeTokenAth({ previous, historicalPrice: { price: 0.01, price_provenance: 'OLD', alerted_at: 'old-price' },
    historicalMc: { market_cap: 40_000, valuation_provenance: 'OLD', alerted_at: 'old-mc' },
    currentPrice: 0.012, currentMc: 50_000, observedAt: 'current', currentVerified: true });
  assert.equal(lower.priceUsd, previous.priceUsd); assert.equal(lower.marketCapUsd, previous.marketCapUsd);
  const higher = mergeTokenAth({ previous, currentPrice: 0.02, currentMc: 80_000, observedAt: 'new-current', currentVerified: true });
  assert.equal(higher.priceUsd, 0.02); assert.equal(higher.marketCapUsd, 80_000);
  assert.equal(higher.priceObservedAt, 'new-current'); assert.equal(higher.marketCapObservedAt, 'new-current');
  const unverified = mergeTokenAth({ previous, currentPrice: 1, currentMc: 9_000_000, observedAt: 'bad', currentVerified: false });
  assert.equal(unverified.priceUsd, previous.priceUsd); assert.equal(unverified.marketCapUsd, previous.marketCapUsd);
  const rendered = renderTokenIntelligence(fixture());
  assert.match(rendered, /ATH MC source\s+<b>ALPHAOS_VERIFIED_OBSERVATION<\/b>/);
  assert.match(rendered, /ATH Price observed <b>2026-08-27T00:00:00.000Z<\/b>/);
});

test('Full Intel performance controls are bounded and deduplicate cache misses', async () => {
  const service = await readFile(new URL('../src/services/tokenIntelligenceService.ts', import.meta.url), 'utf8');
  const holder = await readFile(new URL('../src/chains/robinhood/security/holderRiskScanner.ts', import.meta.url), 'utf8');
  const callback = await readFile(new URL('../src/bot/tokenIntelligenceActions.ts', import.meta.url), 'utf8');
  assert.match(service, /ANALYSIS_DEADLINE_MS = 8_000/);
  assert.match(service, /const inFlight = new Map/); assert.match(service, /if \(running\) return running/);
  assert.match(service, /finally\(\(\) => inFlight\.delete\(key\)\)/);
  assert.match(holder, /timeoutMs \?\? 2_750/); assert.match(holder, /AbortSignal\.any/);
  assert.equal((service.match(/fetchRobinhoodPairs\(token/g) ?? []).length, 1);
  assert.match(callback, /const activeReplies = new Set/); assert.match(callback, /activeReplies\.delete\(replyKey\)/);
  assert.doesNotMatch(callback + service, /adminTrading|autoBuy|executeTrade|ADMIN_BUY|ADMIN_SELL/);
});

test('positive qualification blocks only verified concentration above threshold', () => {
  const base = { elapsedSec: 180, currentRoi: 12, recentPeakRoi: 15, volume5m: 3000, previousVolume5m: 1000 };
  assert.equal(qualifyPremiumOpportunity({ ...base, freshWalletEvidence: 'VERIFIED', freshWallet1dPct: 57 }, 'BUY').eligible, false);
  assert.equal(qualifyPremiumOpportunity({ ...base, freshWalletEvidence: 'VERIFIED', freshWallet1dPct: 50 }, 'CHECK_ENTRY').eligible, true);
  assert.equal(qualifyPremiumOpportunity({ ...base, freshWalletEvidence: 'UNKNOWN', freshWallet1dPct: 99 }, 'BUY').eligible, true);
});

test('cache migration is isolated, service-role-only, and non-destructive', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260828143000_token_intelligence_cache.sql', import.meta.url), 'utf8');
  assert.match(sql, /primary key \(chain, token_address\)/i);
  assert.match(sql, /enable row level security/i); assert.match(sql, /service_role/i);
  assert.doesNotMatch(sql, /drop table|truncate|on delete cascade|wallet_monitor_cursors|trading/i);
});

test('Full Intel access remains available to Free/Pro/Admin while trading.admin stays Admin only', async () => {
  const { accessProfileForTier, hasCapability } = await import('../src/product/capabilities.js');
  for (const tier of ['free', 'pro', 'admin'] as const) assert.equal(hasCapability(accessProfileForTier(tier), 'intelligence.investigations'), true);
  assert.equal(hasCapability(accessProfileForTier('free'), 'trading.admin'), false);
  assert.equal(hasCapability(accessProfileForTier('pro'), 'trading.admin'), false);
  assert.equal(hasCapability(accessProfileForTier('admin'), 'trading.admin'), true);
});
