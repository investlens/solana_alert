import test from 'node:test';
import assert from 'node:assert/strict';
import {
  learnPonsDevelopers,
  selectPonsLearningCandidates,
  type PonsDeveloperLearningDependencies,
} from '../src/chains/robinhood/ponsDeveloperLearning.js';
import type { PonsOutcomeCollection, PonsOutcomeLaunch } from '../src/chains/robinhood/ponsTokenOutcomeCollector.js';
import type { PonsDeveloperRegistryEntry } from '../src/chains/robinhood/ponsDeveloperRegistry.js';

const address = (index: number) => `0x${index.toString(16).padStart(40, '0')}`;
const launch = (tokenIndex: number, deployerIndex: number): PonsOutcomeLaunch => ({
  factory_address: address(999), token_address: address(tokenIndex), deployer_address: address(deployerIndex),
  protocol_version: 'v2-current', block_timestamp: `2026-09-0${tokenIndex}T00:00:00.000Z`,
});
const outcomeCollection = (writes: number): PonsOutcomeCollection => ({
  outcomes: [], scanned: writes, currentMcFound: 0, historicalObservationsFound: 0, verifiedPeakFound: 0,
  crossed100k: 0, crossed500k: 0, crossed1m: 0, crossed5m: 0, crossed10m: 0, unknown: writes,
  currentLookupFailures: 0, wrote: true, writes,
});
const registry = (deployerAddress: string, tier: PonsDeveloperRegistryEntry['tier'] = 'UNKNOWN', totalLaunches = 1): PonsDeveloperRegistryEntry => ({
  deployerAddress, tier, riskTier: null, confidence: 'INSUFFICIENT', isBlocked: false, blockReason: null,
  blockedAt: null, totalLaunches, usableOutcomes: tier === 'GEM' ? 1 : 0, winners100k: tier === 'GEM' ? 1 : 0,
  winners500k: tier === 'GEM' ? 1 : 0, winners1m: tier === 'GEM' ? 1 : 0, winners5m: 0, winners10m: 0,
  bestVerifiedPeakMarketCap: tier === 'GEM' ? 1_000_000 : null, bestTokenAddress: null, hitRate100k: null,
  hitRate1m: null, recent5Hits100k: 0, recent5Hits1m: 0, severeCrashCount: 0, severeCrashRate: null,
  catastrophicCrashCount: 0, catastrophicCrashRate: null, firstLaunchAt: null, latestLaunchAt: null,
  lastSuccessfulTokenAddress: null, lastSuccessfulPeakMarketCap: null,
});

function dependencies(candidates: PonsOutcomeLaunch[], existing: string[], refresh: PonsDeveloperRegistryEntry[]) {
  const calls: string[][] = [];
  const deps: PonsDeveloperLearningDependencies = {
    selectCandidates: async () => candidates,
    collectOutcomes: async rows => outcomeCollection(rows.length),
    loadExistingRegistry: async () => new Set(existing),
    refreshDeployers: async deployers => { calls.push(deployers); return refresh; },
  };
  return { deps, calls };
}

test('learning creates missing registry rows and updates existing rows', async () => {
  const missing = address(100); const existing = address(200);
  const { deps } = dependencies([launch(1, 100), launch(2, 200)], [existing], [registry(missing), registry(existing)]);
  const result = await learnPonsDevelopers({ limit: 2, now: new Date('2026-09-04T00:00:00Z') }, deps);
  assert.equal(result.registryCreated, 1);
  assert.equal(result.registryUpdated, 1);
  assert.equal(result.registryRefreshed, 2);
});

test('multiple tokens from one deployer refresh that deployer only once', async () => {
  const deployer = address(100);
  const { deps, calls } = dependencies([launch(1, 100), launch(2, 100)], [], [registry(deployer, 'UNKNOWN', 7)]);
  const result = await learnPonsDevelopers({ limit: 2 }, deps);
  assert.deepEqual(calls, [[deployer]]);
  assert.equal(result.distinctDeployers, 1);
  assert.equal(result.registryCreated, 1);
});

test('registry result can reflect all authoritative launches, not only the selected token', async () => {
  const deployer = address(100);
  const { deps } = dependencies([launch(1, 100)], [], [registry(deployer, 'UNKNOWN', 25)]);
  let refreshedTotal = 0;
  const originalRefresh = deps.refreshDeployers;
  deps.refreshDeployers = async addresses => {
    const rows = await originalRefresh(addresses); refreshedTotal = rows[0].totalLaunches; return rows;
  };
  await learnPonsDevelopers({ limit: 1 }, deps);
  assert.equal(refreshedTotal, 25);
});

test('repeated selection advances past launches with fresh outcomes and registry rows', () => {
  const launches = [launch(3, 103), launch(2, 102), launch(1, 101)];
  const staleBefore = '2026-09-03T00:00:00.000Z';
  const first = selectPonsLearningCandidates(launches, {
    outcomeCheckedAt: new Map(), registryRefreshedAt: new Map(),
  }, 2, staleBefore);
  assert.deepEqual(first.map(row => row.token_address), [address(3), address(2)]);
  const fresh = '2026-09-04T00:00:00.000Z';
  const second = selectPonsLearningCandidates(launches, {
    outcomeCheckedAt: new Map(first.map(row => [`${row.factory_address}:${row.token_address}`, fresh])),
    registryRefreshedAt: new Map(first.map(row => [row.deployer_address, fresh])),
  }, 2, staleBefore);
  assert.deepEqual(second.map(row => row.token_address), [address(1)]);
});

test('learning summary reports verified GEM and blocked tiers without changing rules', async () => {
  const scammer = { ...registry(address(200), 'SCAMMER', 50), riskTier: 'SCAMMER', isBlocked: true };
  const { deps } = dependencies([launch(1, 100), launch(2, 200)], [], [registry(address(100), 'GEM'), scammer]);
  const result = await learnPonsDevelopers({ limit: 2 }, deps);
  assert.equal(result.tiers.GEM, 1);
  assert.equal(result.tiers.SCAMMER, 1);
  assert.equal(result.blocked, 1);
});
