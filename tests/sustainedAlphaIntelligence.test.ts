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
