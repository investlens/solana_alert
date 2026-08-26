import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildWalletIntelligenceProfile, launchHasMeaningfulPerformance, median } from '../src/services/walletIntelligenceService.js';
import { renderWalletAnalysisIncomplete, renderWalletIntelligence, renderWalletIntelligenceLaunches, renderWalletIntelligenceLinks, withWalletAnalysisGuard } from '../src/bot/walletTracking.js';
import { analyzeRobinhoodWallet, walletAnalysisCacheIsFresh, type HistoricalWalletAnalysis } from '../src/services/walletHistoricalAnalysisService.js';

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
    analyzedAt: '2026-08-26T00:00:00Z', fromBlock: '100', toBlock: '50100', launchSources: ['PONS_V1', 'PONS_V2'], launches: [],
  }, now });
  assert.equal(profile.coverage.historicalAnalysis, 'COMPLETE');
  const rendered = renderWalletIntelligence(profile);
  assert.match(rendered, /No verified PONS launches found/);
  assert.match(rendered, /Coverage\s+Last 50,000 blocks/);
  assert.match(rendered, /Sources\s+PONS V1 · PONS V2/);
  assert.doesNotMatch(rendered, /Verified launches|Severe failures|Catastrophic failures|Reached \$50K|Reached \$100K/);
});

test('expired COMPLETE is historical and a failed fresh scan cannot become zero or overwrite it', async () => {
  const previous: HistoricalWalletAnalysis = { status: 'COMPLETE', analyzedAt: '2026-08-24T00:00:00Z', fromBlock: '1', toBlock: '50000',
    coverage: 'KNOWN_PONS_EMITTERS_BOUNDED', launchSources: ['PONS_V1', 'PONS_V2'], launches: [] };
  assert.equal(walletAnalysisCacheIsFresh(previous.analyzedAt, now.getTime()), false);
  let writes = 0;
  const result = await analyzeRobinhoodWallet(wallet, { now, diagnostics: { invocationId: 'inv-expired-failure' },
    cache: { read: async () => ({ status: 'COMPLETE', result: previous, analyzed_at: previous.analyzedAt }), write: async () => { writes += 1; } },
    rpc: { getBlockNumber: async () => 100_000n, getLogs: async () => { throw new Error('RPC timeout'); }, getBlock: async () => ({ timestamp: 0n }) } as any });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.source, 'FRESH');
  assert.equal(result.errorStage, 'GET_LOGS');
  assert.equal(result.launchesFound, null);
  assert.equal(writes, 0);
  assert.doesNotMatch(renderWalletAnalysisIncomplete(), /Verified launches|0 verified/);
});

test('duplicate Analyze guard runs one invocation and reports the concurrent attempt', async () => {
  let starts = 0; let duplicates = 0; let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = withWalletAnalysisGuard('42:7', async () => { duplicates += 1; }, async () => { starts += 1; await blocked; });
  const second = withWalletAnalysisGuard('42:7', async () => { duplicates += 1; }, async () => { starts += 1; });
  await second; release(); await first;
  assert.equal(starts, 1); assert.equal(duplicates, 1);
});

test('Analyze diagnostics carry the invocation correlation ID', async () => {
  const cached: HistoricalWalletAnalysis = { status: 'COMPLETE', analyzedAt: now.toISOString(), fromBlock: '1', toBlock: '50000',
    coverage: 'KNOWN_PONS_EMITTERS_BOUNDED', launchSources: ['PONS_V1', 'PONS_V2'], launches: [] };
  const records: unknown[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { if (args[0] === '[WalletAnalysis]') records.push(args[1]); };
  try {
    const result = await analyzeRobinhoodWallet(wallet, { now, diagnostics: { invocationId: 'inv-correlation-1', telegramId: '42', walletId: 7 },
      cache: { read: async () => ({ status: 'COMPLETE', result: cached, analyzed_at: cached.analyzedAt }), write: async () => assert.fail('cache hit must not write') } });
    assert.equal(result.status, 'COMPLETE'); assert.equal(result.source, 'CACHE');
  } finally { console.log = original; }
  assert.ok(records.length >= 3);
  assert.ok(records.every(record => (record as Record<string, unknown>).invocationId === 'inv-correlation-1'));
});

test('Analyze error boundaries keep profile and Telegram failures distinct from analysis failure', async () => {
  const source = await readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8');
  assert.match(source, /event: 'PROFILE_FAILED'/);
  assert.match(source, /event: 'TELEGRAM_SEND_FAILED'/);
  assert.match(source, /Wallet analysis is already running/);
  assert.doesNotMatch(source, /Analyze wallet failed:[\s\S]{0,200}Wallet analysis could not be completed/);
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
