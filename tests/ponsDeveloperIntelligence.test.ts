import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregatePonsDeveloperIntelligence, bridgePonsTokenOutcomes, buildPonsDeveloperIntelligence, classifyPonsDeveloper,
  type ExistingCreatorOutcomeRow, type PonsLaunchCensusRow,
} from '../src/chains/robinhood/ponsDeveloperIntelligence.js';

const developer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const walletOnlyToken = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const token = (index: number) => `0x${index.toString(16).padStart(40, '0')}`;
const launch = (index: number, deployerAddress = developer): PonsLaunchCensusRow => ({
  token_address: token(index), deployer_address: deployerAddress, protocol_version: 'v2-current',
  block_timestamp: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
});
const creatorOutcome = (index: number, peak: number, extra: Partial<ExistingCreatorOutcomeRow> = {}): ExistingCreatorOutcomeRow => ({
  token: token(index), creator_wallet: developer, peak_market_cap: peak, current_market_cap: peak / 2,
  tracking_complete: true, severe_crash: false, catastrophic_crash: false, last_checked_at: '2026-09-04T00:00:00.000Z', ...extra,
});

test('bridge accepts only exact normalized token identity', () => {
  const [outcome] = bridgePonsTokenOutcomes([launch(1)], [creatorOutcome(1, 120_000)]);
  assert.equal(outcome.outcomeSource, 'CREATOR_LAUNCHES_EXACT_TOKEN');
  assert.equal(outcome.crossed100k, true); assert.equal(outcome.usable, true);
});

test('wallet-only overlap is not accepted as a Pons token outcome', () => {
  const [outcome] = bridgePonsTokenOutcomes([launch(1)], [{ ...creatorOutcome(2, 500_000), creator_wallet: developer }]);
  assert.equal(outcome.outcomeSource, 'NONE'); assert.equal(outcome.usable, false);
  assert.equal(outcome.peakMarketCap, null);
});

test('unknown peak remains unknown and current market cap is never substituted', () => {
  const [outcome] = bridgePonsTokenOutcomes([launch(1)], [{ token: token(1), current_market_cap: 250_000, tracking_complete: false }]);
  assert.equal(outcome.currentMarketCap, 250_000); assert.equal(outcome.peakMarketCap, null);
  assert.equal(outcome.crossed100k, null); assert.equal(outcome.usable, false);
});

test('incomplete legacy creator rows cannot promote an estimated peak into Pons winner evidence', () => {
  const [outcome] = bridgePonsTokenOutcomes([launch(1)], [{ token: token(1), peak_market_cap: 900_000, crossed_500k: true, tracking_complete: false }]);
  assert.equal(outcome.peakMarketCap, null); assert.equal(outcome.crossed100k, null);
  assert.equal(outcome.crossed500k, null); assert.equal(outcome.usable, false);
});

test('hit-rate denominator includes only usable exact-token outcomes', () => {
  const outcomes = bridgePonsTokenOutcomes([launch(1), launch(2), launch(3)], [creatorOutcome(1, 150_000), creatorOutcome(2, 50_000)]);
  const [result] = aggregatePonsDeveloperIntelligence(outcomes);
  assert.equal(result.totalPonsLaunches, 3); assert.equal(result.launchesWithUsableOutcomes, 2);
  assert.equal(result.winners100k, 1); assert.equal(result.hitRate100k, 0.5);
});

test('a verified $1M developer becomes GEM even with a small sample', () => {
  const [result] = aggregatePonsDeveloperIntelligence(bridgePonsTokenOutcomes([launch(1)], [creatorOutcome(1, 1_500_000)]));
  assert.equal(result.hitRate100k, 1); assert.equal(result.sampleConfidence, 'INSUFFICIENT'); assert.equal(result.tier, 'GEM');
});

test('repeated verified winners qualify deterministically for PROVEN and GEM', () => {
  const provenLaunches = Array.from({ length: 8 }, (_, index) => launch(index));
  const provenRows = Array.from({ length: 8 }, (_, index) => creatorOutcome(index, index < 4 ? (index === 0 ? 600_000 : 120_000) : 50_000));
  assert.equal(aggregatePonsDeveloperIntelligence(bridgePonsTokenOutcomes(provenLaunches, provenRows))[0].tier, 'PROVEN');
  const eliteLaunches = Array.from({ length: 15 }, (_, index) => launch(index));
  const eliteRows = Array.from({ length: 15 }, (_, index) => creatorOutcome(index, index < 9 ? (index === 0 ? 1_200_000 : index < 3 ? 600_000 : 150_000) : 50_000));
  assert.equal(aggregatePonsDeveloperIntelligence(bridgePonsTokenOutcomes(eliteLaunches, eliteRows))[0].tier, 'GEM');
});

test('positive peak tiers follow deterministic thresholds', () => {
  const classify = (winners1m:number,winners5m:number,winners10m:number) => classifyPonsDeveloper({
    totalLaunches:10,usable:10,winners100k:10,winners500k:10,winners1m,winners5m,winners10m,
    hitRate100k:1,severeCrashRate:0,catastrophicCrashes:0,
  });
  assert.equal(classify(1,0,0),'GEM'); assert.equal(classify(3,0,0),'KING');
  assert.equal(classify(1,2,0),'LEGEND'); assert.equal(classify(1,0,1),'LEGEND');
});

test('risk rules require conservative evidence and take precedence', () => {
  const base={winners100k:0,winners500k:0,winners1m:0,winners5m:0,winners10m:0,hitRate100k:0,catastrophicCrashes:0};
  assert.equal(classifyPonsDeveloper({...base,totalLaunches:50,usable:2,severeCrashRate:1}),'SPAM_LAUNCHER');
  assert.equal(classifyPonsDeveloper({...base,totalLaunches:20,usable:10,severeCrashRate:.7}),'SCAMMER');
  assert.notEqual(classifyPonsDeveloper({...base,totalLaunches:20,usable:9,severeCrashRate:1}),'SCAMMER');
  assert.notEqual(classifyPonsDeveloper({...base,totalLaunches:20,usable:10,winners100k:1,winners1m:1,severeCrashRate:1}),'SCAMMER');
  assert.notEqual(classifyPonsDeveloper({...base,totalLaunches:50,usable:10,winners100k:1,severeCrashRate:1}),'SPAM_LAUNCHER');
});

test('sufficient crash-heavy exact-token history classifies HIGH_RISK', () => {
  const launches = Array.from({ length: 5 }, (_, index) => launch(index));
  const rows = Array.from({ length: 5 }, (_, index) => creatorOutcome(index, 40_000, { severe_crash: index < 3, catastrophic_crash: index < 2 }));
  const [result] = aggregatePonsDeveloperIntelligence(bridgePonsTokenOutcomes(launches, rows));
  assert.equal(result.severeCrashRate, 0.6); assert.equal(result.catastrophicCrashCount, 2); assert.equal(result.tier, 'HIGH_RISK');
});

test('recent-5 hit rate is chronological and deterministic', () => {
  const launches = [launch(5), launch(0), launch(4), launch(2), launch(1), launch(3)];
  const rows = Array.from({ length: 6 }, (_, index) => creatorOutcome(index, index >= 3 ? 120_000 : 50_000));
  const [result] = aggregatePonsDeveloperIntelligence(bridgePonsTokenOutcomes(launches, rows));
  assert.equal(result.recent5HitRate100k, 0.6);
});

test('single-developer builder returns structured intelligence and passes an exact normalized filter', async () => {
  let requestedDeveloper: string | undefined; let requestedTokens: string[] = [];
  const result = await buildPonsDeveloperIntelligence({
    loadPonsLaunches: async address => { requestedDeveloper = address; return [launch(1)]; },
    loadCreatorOutcomes: async tokens => { requestedTokens = tokens; return [creatorOutcome(1, 120_000)]; },
  }, developer.toUpperCase());
  assert.equal(requestedDeveloper, developer); assert.deepEqual(requestedTokens, [token(1)]);
  assert.equal(result[0].developerAddress, developer); assert.equal(result[0].tier, 'PROMISING');
});

test('developer intelligence prefers verified Pons-native exact-token outcomes when supplied', async () => {
  const result = await buildPonsDeveloperIntelligence({
    loadPonsLaunches: async () => [launch(1)], loadCreatorOutcomes: async () => [],
    loadPonsNativeOutcomes: async () => [{ token_address: token(1).toUpperCase(), peak_market_cap: 550_000,
      current_market_cap: 80_000, data_confidence: 'VERIFIED_HISTORY', severe_crash: true, last_checked_at: '2026-09-04T00:00:00Z' }],
  });
  assert.equal(result[0].outcomes[0].outcomeSource, 'PONS_NATIVE_EXACT_TOKEN');
  assert.equal(result[0].bestKnownPeakMarketCap, 550_000); assert.equal(result[0].winners500k, 1);
});
