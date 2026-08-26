import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildWalletIntelligenceProfile, launchHasMeaningfulPerformance, median } from '../src/services/walletIntelligenceService.js';
import { renderWalletIntelligence, renderWalletIntelligenceLaunches, renderWalletIntelligenceLinks } from '../src/bot/walletTracking.js';

const wallet = '0xf435ac1926e21d47bfe0916bd1f15c22ca6ceb4b';
const linked = '0x1111111111111111111111111111111111111111';
const token = (index: number) => `0x${index.toString(16).padStart(40, '0')}`;
const now = new Date('2026-08-26T00:00:00Z');

function launch(index: number, overrides: Record<string, unknown> = {}) {
  return {
    token: token(index), symbol: index === 1 ? '<ONE>' : `T${index}`, name: `Token ${index}`,
    launched_at: `2026-08-${String(20 - index).padStart(2, '0')}T00:00:00Z`,
    initial_market_cap: 10_000, peak_market_cap: 20_000, current_market_cap: 12_000,
    return_5m_pct: index * 10, return_15m_pct: index * 20, max_return_pct: index * 25,
    crossed_50k: false, crossed_100k: false, crossed_250k: false, crossed_500k: false, crossed_1m: false,
    severe_crash: false, catastrophic_crash: false, ...overrides,
  };
}

test('wallet intelligence keeps empty history factual and unknown', () => {
  const profile = buildWalletIntelligenceProfile({ walletAddress: wallet, launches: [], shadows: [], flows: [], now });
  assert.equal(profile.launches.total, 0);
  assert.equal(profile.walletAge.firstObservedAt, null);
  assert.equal(profile.launchPerformance.medianMaxReturn, null);
  assert.equal(profile.dataCompleteness.outcomeHistory, false);
  assert.match(profile.reputationEvidence.unknowns.join(' '), /No verified creator launches/);
  const rendered = renderWalletIntelligence(profile);
  assert.match(rendered, /Historical analysis\s+<b>Not run/);
  assert.match(rendered, /Creator history\s+<b>Not established/);
  assert.doesNotMatch(rendered, /Verified launches\s+<b>0/);
});

test('completed bounded coverage may truthfully establish verified zero launches', () => {
  const profile = buildWalletIntelligenceProfile({ walletAddress: wallet, launches: [], shadows: [], flows: [], analysis: {
    analyzedAt: '2026-08-26T00:00:00Z', fromBlock: '100', toBlock: '50100', launches: [],
  }, now });
  assert.equal(profile.coverage.historicalAnalysis, 'COMPLETE');
  assert.match(renderWalletIntelligence(profile), /Verified launches\s+<b>0/);
  assert.match(renderWalletIntelligence(profile), /bounded known-PONS-emitter coverage/);
});
test('one measured launch uses conservative success, medians, best and worst', () => {
  const profile = buildWalletIntelligenceProfile({ walletAddress: wallet, launches: [launch(1, { max_return_pct: 50 })], shadows: [], flows: [], now });
  assert.equal(profile.launches.total, 1);
  assert.equal(profile.reputationEvidence.repeatLauncher, false);
  assert.equal(profile.launchPerformance.successfulLaunches, 1);
  assert.equal(profile.launchPerformance.bestLaunch?.token, token(1));
  assert.equal(profile.launchPerformance.worstLaunch?.token, token(1));
  assert.equal(launchHasMeaningfulPerformance(profile.launches.tokens[0]), true);
  assert.equal(median([10, null, 20, 30]), 20);
});

test('more than three launches exposes repeat history, failures, milestones and measured medians', () => {
  const launches = [
    launch(1, { max_return_pct: -95, severe_crash: true, catastrophic_crash: true }),
    launch(2, { max_return_pct: -82, severe_crash: true }),
    launch(3, { max_return_pct: 60, crossed_50k: true }),
    launch(4, { max_return_pct: 200, crossed_50k: true, crossed_100k: true }),
  ];
  const profile = buildWalletIntelligenceProfile({ walletAddress: wallet, launches, shadows: [], flows: [], now });
  assert.equal(profile.reputationEvidence.repeatLauncher, true);
  assert.equal(profile.reputationEvidence.launchCountNegative, true);
  assert.equal(profile.launchPerformance.severeCrashes, 2);
  assert.equal(profile.launchPerformance.catastrophicCrashes, 1);
  assert.equal(profile.launchPerformance.crossed50k, 2);
  assert.equal(profile.launchPerformance.crossed100k, 1);
  assert.equal(profile.launchPerformance.medianMaxReturn, -11);
  assert.equal(profile.launchPerformance.bestLaunch?.token, token(4));
  assert.equal(profile.launchPerformance.worstLaunch?.token, token(1));
});

test('verified sell, transfer, burn and associated counterparty evidence remain distinct', () => {
  const flows = [
    { asset_id: token(1), semantic_event_type: 'DEV_SELL', alerted_at: '2026-08-19T00:06:00Z', raw_snapshot: { sold: true } },
    { asset_id: token(1), semantic_event_type: 'DEV_TRANSFER', alerted_at: '2026-08-19T00:07:00Z', raw_snapshot: { destinations: [linked], movedPercentOfSupply: 2 } },
    { asset_id: token(2), semantic_event_type: 'DEV_TRANSFER', alerted_at: '2026-08-18T00:08:00Z', raw_snapshot: { destinations: [linked], movedPercentOfSupply: 3 } },
    { asset_id: token(2), semantic_event_type: 'DEV_BURN', alerted_at: '2026-08-18T00:09:00Z', burned_percent: 1.5, raw_snapshot: { burned: true } },
  ];
  const profile = buildWalletIntelligenceProfile({ walletAddress: wallet, launches: [launch(1), launch(2)], shadows: [], flows, now });
  assert.equal(profile.developerBehavior.launchesWithDevSell, 1);
  assert.equal(profile.developerBehavior.observedTransfers, 2);
  assert.equal(profile.developerBehavior.launchesWithBurn, 1);
  assert.equal(profile.developerBehavior.associatedWallets[0].wallet, linked);
  assert.equal(profile.developerBehavior.associatedWallets[0].distinctLaunches, 2);
  assert.equal(profile.developerBehavior.associatedWallets[0].transferEvents, 2);
  assert.equal(profile.developerBehavior.associatedWallets[0].evidenceType, 'VERIFIED_DEVELOPER_TOKEN_TRANSFER');
});

test('unverified destinations do not create association evidence and age says first observed', () => {
  const profile = buildWalletIntelligenceProfile({
    walletAddress: wallet, launches: [launch(1)], shadows: [],
    flows: [{ asset_id: token(1), semantic_event_type: 'DEV_SELL', alerted_at: '2026-08-19T00:06:00Z', raw_snapshot: { destinations: [linked] } }],
    walletActivityObservedAt: ['2026-08-01T00:00:00Z'], now,
  });
  assert.equal(profile.developerBehavior.associatedWallets.length, 0);
  assert.equal(profile.walletAge.firstObservedAt, '2026-08-01T00:00:00Z');
  assert.equal(profile.walletAge.source, 'TRACKED_WALLET_ACTIVITY');
});

test('intelligence screens escape data, avoid ownership claims and keep callbacks compact', async () => {
  const profile = buildWalletIntelligenceProfile({
    walletAddress: wallet, launches: [launch(1)], shadows: [],
    flows: [{ asset_id: token(1), semantic_event_type: 'DEV_TRANSFER', alerted_at: '2026-08-19T00:07:00Z', raw_snapshot: { destinations: [linked], movedPercentOfSupply: 2 } }], now,
  });
  assert.match(renderWalletIntelligence(profile), /ALPHAOS · WALLET INTELLIGENCE/);
  assert.match(renderWalletIntelligenceLaunches(profile), /&lt;ONE&gt;/);
  const links = renderWalletIntelligenceLinks(profile);
  assert.match(links, /does not establish ownership/);
  assert.doesNotMatch(links, /same owner|second wallet|insider/i);
  const source = await readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8');
  assert.match(source, /wallet\.chain === 'robinhood'.*🧠 Intelligence/);
  assert.doesNotMatch(source, /wallet\.chain === 'evm'.*WALLET_INTEL_/);
  for (const callback of ['WALLET_INTEL_123456789', 'WALLET_INTEL_LAUNCHES_123456789', 'WALLET_INTEL_LINKS_123456789']) {
    assert.ok(Buffer.byteLength(callback, 'utf8') <= 64);
  }
});
