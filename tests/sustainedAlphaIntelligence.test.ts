import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assessLiquiditySafety } from '../src/intelligence/liquiditySafety.js';
import { assessTokenIntelligence, developerEvent } from '../src/intelligence/tokenIntelligenceState.js';
import { detectTrackedWalletCluster } from '../src/intelligence/walletConvergence.js';
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';

const observations = (rois: number[], volumes = [100, 160, 220], liquidities = [10_000, 10_500, 11_000]) => rois.map((roi, index) => ({ roi, volume5m: volumes[index], liquidity: liquidities[index], buys5m: 20, sells5m: 10, observedAt: new Date(index * 30_000).toISOString() }));

test('launch alone remains DISCOVERED and cannot become Entry Ready', () => {
  assert.equal(assessTokenIntelligence({ observations: observations([0]).slice(0, 1) }).state, 'DISCOVERED');
});
test('small pullback with stable evidence is COOLING, while multi-factor deterioration is DANGER', () => {
  assert.equal(assessTokenIntelligence({ priorState: 'CONFIRMED', observations: observations([5, 12, 9]) }).state, 'COOLING');
  const danger = assessTokenIntelligence({ observations: observations([10, 5, -2], [200, 140, 80], [20_000, 15_000, 10_000]).map(row => ({ ...row, buys5m: 5, sells5m: 30 })) });
  assert.equal(danger.state, 'DANGER');
});
test('critical risk overrides dev holding and developer events retain evidence semantics', () => {
  assert.equal(assessTokenIntelligence({ observations: observations([5, 8, 7]), risk: { criticalSecurity: true, developerHoldingPercent: 0 } }).state, 'DANGER');
  assert.equal(developerEvent({ soldPercent: 2, transferredPercent: 2, evidence: 'VERIFIED' }).type, 'DEV_SELL');
  assert.equal(developerEvent({ transferredPercent: 2, evidence: 'VERIFIED' }).type, 'DEV_TRANSFER');
  assert.equal(developerEvent({ burnedPercent: 5, evidence: 'VERIFIED' }).type, 'DEV_BURN');
});
test('volume acceleration is transitional and runner requires prior confirmation', () => {
  const current = assessTokenIntelligence({ observations: observations([3, 7, 9]) });
  assert.equal(current.volumeSurge, true); assert.equal(current.state, 'CONFIRMED');
  assert.notEqual(assessTokenIntelligence({ observations: observations([3, 7, 9]), config: { volumeAccelerationRatio: 3 } }).state, 'RUNNER');
  assert.equal(assessTokenIntelligence({ priorState: 'CONFIRMED', observations: observations([8, 10, 12]) }).state, 'RUNNER');
});
test('sustained intelligence requires the configured observation span as well as counts', () => {
  const short = (seconds: number[]) => seconds.map((second, index) => ({
    roi: index + 1, observedAt: new Date(second * 1000).toISOString(),
  }));
  assert.equal(assessTokenIntelligence({ observations: short([0, 2, 5]) }).sustained, false);
  assert.equal(assessTokenIntelligence({ observations: short([0, 5, 10]) }).sustained, false);
  assert.equal(assessTokenIntelligence({ observations: short([0, 10, 30]) }).sustained, true);
  assert.equal(assessTokenIntelligence({ observations: short([0, 5, 10]),
    config: { minimumSustainedSeconds: 10 } }).sustained, true);
});
test('liquidity direction distinguishes increasing, stable, falling and explicit critical', () => {
  assert.equal(assessTokenIntelligence({ observations: observations([2, 3, 4], undefined, [10_000, 13_000, 16_000]) }).liquidityTrend, 'BUILDING');
  assert.equal(assessTokenIntelligence({ observations: observations([2, 3, 4], undefined, [10_000, 10_200, 9_900]) }).liquidityTrend, 'STABLE');
  assert.equal(assessTokenIntelligence({ observations: observations([2, 3, 4], undefined, [20_000, 15_000, 10_000]) }).liquidityTrend, 'FALLING');
  assert.equal(assessTokenIntelligence({ observations: observations([2, 3, 4]), risk: { liquidityCritical: true } }).liquidityTrend, 'CRITICAL');
});
test('LP evidence is conservative across supported pool semantics', () => {
  assert.equal(assessLiquiditySafety({ chain: 'solana', poolType: 'ERC20_LP', lpOwnerVerified: true, verifiedLocker: 'locker', source: 'verified' }).status, 'LOCKED');
  assert.equal(assessLiquiditySafety({ chain: 'solana', poolType: 'ERC20_LP', lpOwnerVerified: true, verifiedBurnDestination: 'burn', source: 'verified' }).status, 'BURNED');
  assert.equal(assessLiquiditySafety({ chain: 'solana', poolType: 'ERC20_LP', lpOwnerVerified: true, ownerIsCreatorOrTeam: true }).status, 'UNLOCKED');
  assert.equal(assessLiquiditySafety({ chain: 'solana', poolType: 'UNKNOWN' }).status, 'UNKNOWN');
  assert.equal(assessLiquiditySafety({ chain: 'solana', poolType: 'CONCENTRATED_LIQUIDITY', verifiedLocker: 'fake' }).status, 'UNKNOWN');
  assert.equal(assessLiquiditySafety({ chain: 'robinhood', poolType: 'PONS_CURVE', verifiedLocker: 'fake' }).status, 'UNKNOWN');
});
test('Boost remains immediate context and >=200 keeps boosted opportunity label without BUY', async () => {
  const { boostNotificationState, BOOSTED_OPPORTUNITY_THRESHOLD } = await import('../src/chains/robinhood/robinhoodBoostObserver.js');
  assert.equal(BOOSTED_OPPORTUNITY_THRESHOLD, 200); assert.equal(boostNotificationState(199), 'BUILDING'); assert.equal(boostNotificationState(200), 'BOOSTED_OPPORTUNITY');
});
test('PONS states normalize without changing commercial classifier thresholds', async () => {
  const { ponsIntelligenceState } = await import('../src/chains/robinhood/ponsShadowOutcomeTracker.js');
  assert.equal(ponsIntelligenceState('ENTRY_WINDOW'), 'CONFIRMED'); assert.equal(ponsIntelligenceState('FADING'), 'WEAKENING');
});
test('wallet convergence uses neutral bounded evidence, not fabricated quality', () => {
  const rows = ['a', 'b', 'c'].map((walletAddress, index) => ({ walletAddress, tokenAddress: 'token', detectedAt: new Date(index * 30_000).toISOString() }));
  assert.equal(detectTrackedWalletCluster(rows)?.wording, '3 tracked wallets bought within 2m');
});
test('semantic events, health diagnostic and PAPER scaffold are durable and non-executing', async () => {
  const semantic = await readFile(new URL('../src/services/alphaSemanticEventService.ts', import.meta.url), 'utf8');
  const observer = await readFile(new URL('../src/chains/robinhood/robinhoodObserver.ts', import.meta.url), 'utf8');
  const boost = await readFile(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts', import.meta.url), 'utf8');
  const health = await readFile(new URL('../scripts/checkWalletMonitorHealth.ts', import.meta.url), 'utf8');
  const paper = await readFile(new URL('../src/services/paperSniperConfigService.ts', import.meta.url), 'utf8');
  assert.match(semantic, /event_identity: `v2:/); assert.match(observer, /type: 'DEX_PAID'/); assert.match(boost, /type: 'BOOST'/);
  assert.doesNotMatch(health, /insert\(|update\(|upsert\(|delete\(/); assert.match(paper, /mode !== 'PAPER'/); assert.match(paper, /intentionally not connected/);
});

test('exact large stale cursor rebases without replay when no delivery is unresolved', async () => {
  const { walletCursorRecoveryDecision } = await import('../src/chains/robinhood/robinhoodWalletWatcher.js');
  const decision = walletCursorRecoveryDecision({ cursor: 44_538_502n, chainHead: 45_026_686n, unresolvedDeliveries: 0 });
  assert.equal(decision.lag, 488_184n); assert.equal(decision.rebase, true); assert.equal(decision.health, 'STALE');
});
test('unresolved delivery prevents unsafe rebase and per-wallet checkpoints prevent starvation', async () => {
  const { walletCursorRecoveryDecision } = await import('../src/chains/robinhood/robinhoodWalletWatcher.js');
  assert.equal(walletCursorRecoveryDecision({ cursor: 1n, chainHead: 500_000n, unresolvedDeliveries: 1 }).health, 'BLOCKED');
  const source = await readFile(new URL('../src/chains/robinhood/robinhoodWalletWatcher.ts', import.meta.url), 'utf8');
  assert.match(source, /for \(const wallet of existingWallets\)/); assert.match(source, /checkpointBlocks\.set\(key, toBlock\)/);
  assert.match(source, /Rebased stale cursor without historical replay/);
});
test('persisted confirmation needs a later observation before RUNNER', async () => {
  const { nextPonsRuntimeIntelligenceState } = await import('../src/chains/robinhood/ponsShadowOutcomeTracker.js');
  const base = { classifiedState: 'ENTRY_WINDOW', priorState: 'CONFIRMED', priorObservedAt: '2026-08-24T00:00:00Z', currentRoi: 12, peakRoi: 15, confirmedDevMovement: false };
  assert.equal(nextPonsRuntimeIntelligenceState({ ...base, observedAt: '2026-08-24T00:00:00Z' }), 'CONFIRMED');
  assert.equal(nextPonsRuntimeIntelligenceState({ ...base, observedAt: '2026-08-24T00:00:01Z' }), 'RUNNER');
  assert.equal(nextPonsRuntimeIntelligenceState({ ...base, priorState: 'RUNNER', observedAt: '2026-08-24T00:00:02Z' }), 'RUNNER');
  assert.equal(nextPonsRuntimeIntelligenceState({ ...base, observedAt: '2026-08-24T00:00:01Z', confirmedDevMovement: true }), 'CONFIRMED');
});
test('runtime state producers expose material transitions while cooling remains quiet', async () => {
  const { nextPonsRuntimeIntelligenceState } = await import('../src/chains/robinhood/ponsShadowOutcomeTracker.js');
  assert.equal(nextPonsRuntimeIntelligenceState({ classifiedState: 'MOMENTUM_BUILDING', priorState: null, priorObservedAt: null, observedAt: '2026-08-24T00:00:00Z', currentRoi: 5, peakRoi: 5, confirmedDevMovement: false }), 'BUILDING');
  assert.equal(nextPonsRuntimeIntelligenceState({ classifiedState: 'ENTRY_WINDOW', priorState: 'BUILDING', priorObservedAt: '2026-08-24T00:00:00Z', observedAt: '2026-08-24T00:00:01Z', currentRoi: 8, peakRoi: 8, confirmedDevMovement: false }), 'CONFIRMED');
  const source = await readFile(new URL('../src/chains/robinhood/ponsShadowOutcomeTracker.ts', import.meta.url), 'utf8');
  assert.match(source, /\['BUILDING', 'RUNNER'\]\.includes\(nextState\)/); assert.doesNotMatch(source, /\['BUILDING', 'RUNNER', 'COOLING'\]\.includes\(nextState\)/);
});
test('PONS BUILDING Telegram gate rejects 5s and 10s screenshots and opens after 30s', async () => {
  const { assessPonsBuildingGate } = await import('../src/chains/robinhood/ponsShadowOutcomeTracker.js');
  const detectedAt = '2026-08-25T00:00:00.000Z';
  const base = { would_buy_at: detectedAt, detected_at: detectedAt, roi_5s_percent: 5,
    roi_10s_percent: 7, roi_30s_percent: null, roi_1m_percent: null,
    roi_2m_percent: null, roi_5m_percent: null };
  assert.equal(assessPonsBuildingGate({ row: { ...base, roi_5s_percent: null, roi_10s_percent: null },
    currentRoi: 5, peakRoi: 5, observedAt: '2026-08-25T00:00:05.000Z' }).sustained, false);
  assert.equal(assessPonsBuildingGate({ row: { ...base, roi_10s_percent: null },
    currentRoi: 7, peakRoi: 7, observedAt: '2026-08-25T00:00:10.000Z' }).ageEligible, false);
  const eligible = assessPonsBuildingGate({ row: base, currentRoi: 10, peakRoi: 12,
    observedAt: '2026-08-25T00:00:30.000Z' });
  assert.equal(eligible.sustained, true); assert.equal(eligible.ageEligible, true);
  assert.equal(eligible.positiveRetainedStructure, true);
  assert.equal(assessPonsBuildingGate({ row: base, currentRoi: 4, peakRoi: 10,
    observedAt: '2026-08-25T00:00:30.000Z' }).positiveRetainedStructure, false);
});
test('volume surge requires comparable m5 data and deduplicates within one Boost transition', async () => {
  const { isMaterialVolumeSurge } = await import('../src/chains/robinhood/robinhoodBoostObserver.js');
  assert.equal(isMaterialVolumeSurge({ previousVolume5m: null, currentVolume5m: 200, previousPrice: 1, currentPrice: 1 }), false);
  assert.equal(isMaterialVolumeSurge({ previousVolume5m: 100, currentVolume5m: 150, previousPrice: 1, currentPrice: 0.8 }), true);
  const source = await readFile(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts', import.meta.url), 'utf8');
  assert.match(source, /comparisonWindow: 'DEXSCREENER_M5_TO_DEXSCREENER_M5'/); assert.match(source, /identity: `\$\{eventId\}:volume-surge`/);
});
test('developer burn and transfer materiality preserve internal evidence', () => {
  assert.equal(developerEvent({ burnedPercent: 0.2, evidence: 'VERIFIED' }).notify, false);
  assert.equal(developerEvent({ transferredPercent: 0.1, evidence: 'VERIFIED' }).notify, false);
  assert.equal(developerEvent({ transferredPercent: 1, evidence: 'VERIFIED' }).notify, false);
  assert.equal(developerEvent({ soldPercent: 0.01, evidence: 'VERIFIED' }).notify, true);
});
test('Dex Paid and Boost each have one active semantic producer', async () => {
  const observer = await readFile(new URL('../src/chains/robinhood/robinhoodObserver.ts', import.meta.url), 'utf8');
  const boost = await readFile(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts', import.meta.url), 'utf8');
  assert.equal(observer.match(/type: 'DEX_PAID'/g)?.length, 1); assert.equal(boost.match(/type: 'BOOST'/g)?.length, 1);
});
