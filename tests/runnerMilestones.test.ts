import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { evaluateProAlertNotification } from '../src/services/proAlertNotificationGovernor.js';
import { buildAlphaOutcomeCheckpoint } from '../src/services/alphaAlertOutcomeCheckpoints.js';
import { mergeTokenAth } from '../src/services/tokenIntelligenceService.js';
import { canonicalRunnerEntry, planRunnerMilestones, renderRunnerMilestone,
  runnerMilestoneIdentity, athObservationIdentity, athAlertIdentity, highestComparableRunnerObservation,
  ATH_ALERT_EXPANSION_PERCENT, selectWinnerDelivery,
  type RunnerEntry, type RunnerHistoryPrice, type RunnerObservation } from '../src/services/runnerMilestoneService.js';

const entry = (overrides: Partial<RunnerEntry> = {}): RunnerEntry => ({ id: 10, event_identity: 'v1:entry:10', opportunity_id: 7,
  asset_id: '0x1111111111111111111111111111111111111111', chain: 'robinhood', lifecycle_action: 'CHECK_ENTRY',
  strategy_key: 'PONS_BREAKOUT', symbol: 'ALPHA', price: 1, price_provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR',
  market_index_state: 'VERIFIED', alerted_at: '2026-08-30T00:00:00.000Z', intelligence_state: 'RUNNER',
  raw_snapshot: {}, ...overrides });
const observation = (currentPrice: number, overrides: Partial<RunnerObservation> = {}): RunnerObservation => ({
  outcomeId: 44, alertEventId: 10, currentPrice, priceProvenance: 'DEXSCREENER_VERIFIED_BASE_PAIR',
  measuredAt: '2026-08-30T00:01:00.000Z', measurementSource: 'ROBINHOOD_MARKET_SNAPSHOT', ...overrides });
const history = (prices: number[] = [1]): RunnerHistoryPrice[] => prices.map((value, index) => ({
  id: index + 1, chain: 'robinhood', token: entry().asset_id, price: value,
  provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', marketIndexState: 'VERIFIED',
  observedAt: `2026-08-30T00:00:0${index}.000Z`, semanticType: index ? 'ATH_OBSERVATION' : 'CHECK_ENTRY',
}));

test('runner boundaries are exact and 50 then 100 produces exactly two durable semantic milestones', () => {
  assert.equal(planRunnerMilestones({ entry: entry(), observation: observation(1.4999), history: history() }).runner50, false);
  const fifty = planRunnerMilestones({ entry: entry(), observation: observation(1.5), history: history() });
  assert.equal(fifty.runner50, true); assert.equal(fifty.runner100, false);
  assert.equal(planRunnerMilestones({ entry: entry(), observation: observation(1.9999), history: history() }).runner100, false);
  const hundred = planRunnerMilestones({ entry: entry(), observation: observation(2), history: history(),
    existingSemanticTypes: new Set(['RUNNER_50']) });
  assert.equal(hundred.runner50, false); assert.equal(hundred.runner100, true);
  const restart = planRunnerMilestones({ entry: entry(), observation: observation(2.2), history: history(),
    existingSemanticTypes: new Set(['RUNNER_50', 'RUNNER_100']) });
  assert.equal(restart.runner50, false); assert.equal(restart.runner100, false);
  assert.equal(runnerMilestoneIdentity('thesis', 50), runnerMilestoneIdentity('thesis', 50));
  assert.notEqual(runnerMilestoneIdentity('thesis', 50), runnerMilestoneIdentity('thesis', 100));
  assert.equal(athObservationIdentity('thesis', 44), athObservationIdentity('thesis', 44));
  assert.equal(athAlertIdentity('thesis', 44), athAlertIdentity('thesis', 44));
});

test('stored comparable peaks recover milestones after delivery becomes visible without exact threshold observations', () => {
  const canonical = canonicalRunnerEntry([entry()], new Set([10]));
  assert.ok(canonical);
  const seventyThree = observation(1.73, { outcomeId: 30, measuredAt: '2026-08-30T00:00:30.000Z' });
  const laterTwenty = observation(1.2, { outcomeId: 60, measuredAt: '2026-08-30T00:01:00.000Z' });
  const recovered = highestComparableRunnerObservation(canonical, [seventyThree, laterTwenty]);
  assert.equal(recovered?.observation.outcomeId, 30);
  const fifty = planRunnerMilestones({ entry: canonical, observation: recovered!.observation, history: history() });
  assert.equal(fifty.runner50, true); assert.equal(fifty.runner100, false);

  const oneTwentyOne = observation(2.21, { outcomeId: 31, measuredAt: '2026-08-30T00:00:30.000Z' });
  const both = highestComparableRunnerObservation(canonical, [oneTwentyOne, laterTwenty]);
  const bothPlan = planRunnerMilestones({ entry: canonical, observation: both!.observation, history: history() });
  assert.equal(bothPlan.runner50, true); assert.equal(bothPlan.runner100, true);
  const restart = planRunnerMilestones({ entry: canonical, observation: both!.observation, history: history(),
    existingSemanticTypes: new Set(['RUNNER_50', 'RUNNER_100']) });
  assert.equal(restart.runner50, false); assert.equal(restart.runner100, false);
});

test('stored outcome recovery ignores incomparable, pre-entry and sub-50 observations', () => {
  const canonical = entry({ alerted_at: '2026-08-30T00:01:00.000Z' });
  const beforeEntry = observation(3, { outcomeId: 1, measuredAt: '2026-08-30T00:00:30.000Z' });
  const incomparable = observation(4, { outcomeId: 2, measuredAt: '2026-08-30T00:02:00.000Z',
    priceProvenance: 'PONS_V2_CURVE_RESERVE_RATIO' });
  const below = observation(1.4999, { outcomeId: 3, measuredAt: '2026-08-30T00:03:00.000Z' });
  const selected = highestComparableRunnerObservation(canonical, [beforeEntry, incomparable, below]);
  assert.equal(selected?.observation.outcomeId, 3);
  assert.equal(planRunnerMilestones({ entry: canonical, observation: selected!.observation,
    history: history() }).runner50, false);
});

test('RYZEN, FRENS and 9TO5 canonical outcome replay uses only the original delivered thesis checkpoints', () => {
  const replay = (entryPrice: number, observations: number[]) => {
    const canonical = entry({ price: entryPrice });
    const stored = observations.map((currentPrice, index) => observation(currentPrice, {
      outcomeId: index + 1, measuredAt: `2026-08-30T00:${String(index + 1).padStart(2, '0')}:00.000Z`,
    }));
    const highest = highestComparableRunnerObservation(canonical, stored);
    return planRunnerMilestones({ entry: canonical, observation: highest!.observation,
      history: [{ chain: canonical.chain, token: canonical.asset_id, price: entryPrice,
        provenance: canonical.price_provenance, marketIndexState: canonical.market_index_state,
        observedAt: canonical.alerted_at, semanticType: 'CHECK_ENTRY' }] });
  };
  const ryzen = replay(0.00002685, [0.00002685, 0.00002733, 0.00002776, 0.00002766, 0.00002792, 0.00002746, 0.00002946]);
  assert.equal(ryzen.runner50, false); assert.equal(ryzen.runner100, false);
  const frens = replay(0.0001414, [0.0001364, 0.0001285, 0.0001262, 0.0001227, 0.000101, 0.0002135, 0.0001933]);
  assert.equal(frens.runner50, true); assert.equal(frens.runner100, false);
  const nineToFive = replay(0.0001831, [0.0001831, 0.0001803, 0.0001942, 0.0001878, 0.0001884, 0.0001857, 0.0001782]);
  assert.equal(nineToFive.runner50, false); assert.equal(nineToFive.runner100, false);
});

test('canonical entry is the first delivered comparable BUY/CHECK_ENTRY and momentum never resets it', () => {
  const first = entry({ id: 1, event_identity: 'first', alerted_at: '2026-08-30T00:00:00Z', price: 1 });
  const later = entry({ id: 2, event_identity: 'runner', alerted_at: '2026-08-30T00:01:00Z', price: 1.4,
    intelligence_state: 'RUNNER' });
  assert.equal(canonicalRunnerEntry([later, first], new Set([1, 2]))?.event_identity, 'first');
  assert.equal(canonicalRunnerEntry([first], new Set()), null);
});

test('ATH updates are monotonic while intermediate highs are stored and 30% is alertable', () => {
  const below = planRunnerMilestones({ entry: entry(), observation: observation(1.9), history: history([1, 2]), lastAlertedAth: 2 });
  assert.equal(below.newAthObserved, false); assert.equal(below.athAlert, false);
  const tiny = planRunnerMilestones({ entry: entry(), observation: observation(2.099), history: history([1, 2]), lastAlertedAth: 2 });
  assert.equal(tiny.newAthObserved, true); assert.equal(tiny.athAlert, false); assert.equal(tiny.newAth, 2.099);
  const material = planRunnerMilestones({ entry: entry(), observation: observation(2.6), history: history([1, 2]), lastAlertedAth: 2 });
  assert.equal(material.athAlert, true);
  assert.equal(ATH_ALERT_EXPANSION_PERCENT, 30);
  const merged = mergeTokenAth({ previous: { priceUsd: 2, priceObservedAt: '2026-08-30T00:00:00Z', priceSource: 'DEXSCREENER_VERIFIED_BASE_PAIR',
    marketCapUsd: 100, marketCapObservedAt: '2026-08-30T00:00:00Z', marketCapSource: 'VERIFIED_MARKET_INDEX',
    distanceFromPricePct: null, distanceFromMarketCapPct: null }, currentPrice: 1.5, currentMc: 500,
    observedAt: '2026-08-30T00:02:00Z', currentVerified: true });
  assert.equal(merged.priceUsd, 2); assert.equal(merged.marketCapUsd, 500);
});

test('first tracked ATH is a silent baseline and only a later 30% step alerts once', () => {
  const first = planRunnerMilestones({ entry: entry(), observation: observation(1.06), history: history(),
    lastAlertedAth: null, athNotificationBaseline: null });
  assert.equal(first.newAthObserved, true); assert.equal(first.newAth, 1.06); assert.equal(first.athAlert, false);
  const firstStored = history([1, 1.06]);
  const small = planRunnerMilestones({ entry: entry(), observation: observation(1.08), history: firstStored,
    lastAlertedAth: null, athNotificationBaseline: 1.06 });
  assert.equal(small.newAthObserved, true); assert.equal(small.athAlert, false);
  const under = planRunnerMilestones({ entry: entry(), observation: observation(1.3778), history: history([1, 1.06, 1.08]),
    lastAlertedAth: null, athNotificationBaseline: 1.06 });
  assert.equal(under.athAlert, false);
  const material = planRunnerMilestones({ entry: entry(), observation: observation(1.378), history: history([1, 1.06, 1.08]),
    lastAlertedAth: null, athNotificationBaseline: 1.06 });
  assert.equal(material.athAlert, true);
  const restart = planRunnerMilestones({ entry: entry(), observation: observation(1.378),
    history: history([1, 1.06, 1.08, 1.378]), lastAlertedAth: 1.378, athNotificationBaseline: 1.378 });
  assert.equal(restart.newAthObserved, false); assert.equal(restart.athAlert, false);
  const underNextStep = planRunnerMilestones({ entry: entry(), observation: observation(1.78), history: history([1, 1.378, 1.7]),
    lastAlertedAth: 1.378, athNotificationBaseline: 1.378 });
  assert.equal(underNextStep.newAthObserved, true); assert.equal(underNextStep.athAlert, false);
  const nextStep = planRunnerMilestones({ entry: entry(), observation: observation(1.7915), history: history([1, 1.378, 1.78]),
    lastAlertedAth: 1.378, athNotificationBaseline: 1.378 });
  assert.equal(nextStep.athAlert, true);
});

test('winner coalescing records both crossed thresholds but selects one highest-priority delivery', () => {
  const crossed = planRunnerMilestones({ entry: entry(), observation: observation(2.12), history: history([1, 1.42]) });
  assert.equal(crossed.runner50, true); assert.equal(crossed.runner100, true);
  assert.equal(selectWinnerDelivery({ runner50: crossed.runner50, runner100: crossed.runner100, athAlert: true }), 'RUNNER_100');
  assert.equal(selectWinnerDelivery({ runner50: true, runner100: false, athAlert: true }), 'RUNNER_50');
  assert.equal(selectWinnerDelivery({ runner50: false, runner100: false, athAlert: true }), 'NEW_ATH');
});

test('runner presentation can carry a coalesced AlphaOS ATH without a second alert', () => {
  const message = renderRunnerMilestone({ kind: 'RUNNER_100', entry: entry(), observation: observation(2.12), roi: 112,
    ath: { baseline: 1.6, current: 2.12, expansionPct: 32.5 } });
  assert.match(message, /\+100% MAJOR RUNNER/); assert.match(message, /AlphaOS ATH/);
  assert.match(message, /ATH Expansion: <b>\+32\.5%/); assert.doesNotMatch(message, /Trade/);
});

test('incomparable PONS curve/index provenance creates neither runner nor fake ATH', () => {
  const curve = entry({ price: 0.000001, price_provenance: 'PONS_V2_CURVE_RESERVE_RATIO', market_index_state: 'NOT_INDEXED' });
  const result = planRunnerMilestones({ entry: curve, observation: observation(1, { priceProvenance: 'DEXSCREENER_VERIFIED_BASE_PAIR' }),
    history: [{ chain: 'robinhood', token: curve.asset_id, price: curve.price, provenance: curve.price_provenance,
      marketIndexState: 'NOT_INDEXED', observedAt: curve.alerted_at }] });
  assert.equal(result.comparable, false); assert.equal(result.runner50, false); assert.equal(result.athAlert, false);
  const ath = mergeTokenAth({ previous: { priceUsd: 999, priceObservedAt: curve.alerted_at, priceSource: 'PONS_V2_CURVE_RESERVE_RATIO',
    marketCapUsd: null, marketCapObservedAt: null, marketCapSource: null, distanceFromPricePct: null, distanceFromMarketCapPct: null },
    currentPrice: 1, currentMc: 1000, observedAt: observation(1).measuredAt, currentVerified: true,
    chain: 'robinhood', token: curve.asset_id });
  assert.equal(ath.priceUsd, 1);
});

test('critical risk changes interpretation without suppressing the factual milestone and message stays bounded', () => {
  const plan = planRunnerMilestones({ entry: entry(), observation: observation(1.5, { riskLabel: 'CRITICAL' }), history: history() });
  assert.equal(plan.runner50, true);
  const message = renderRunnerMilestone({ kind: 'RUNNER_50', entry: entry(), observation: observation(1.5, { riskLabel: 'CRITICAL' }), roi: 50 });
  assert.match(message, /critical risk is present/); assert.doesNotMatch(message, /BUY|Trade/); assert.ok(message.length < 4096);
});

test('outcome comparability, Pro Alerts V2 and scanner source behavior remain unchanged', async () => {
  const checkpoint = buildAlphaOutcomeCheckpoint({ event: { id: 1, asset_id: entry().asset_id, chain: 'robinhood', price: 1,
    price_provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', market_index_state: 'VERIFIED', alerted_at: entry().alerted_at },
    checkpointSeconds: 60, currentPrice: 1.5, source: 'ROBINHOOD_MARKET_SNAPSHOT',
    provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', prior: [] });
  assert.equal(checkpoint.status, 'MEASURED'); assert.equal(checkpoint.current_roi, 50);
  assert.equal(evaluateProAlertNotification({ hasPriorAlert: true, historyStatus: 'AVAILABLE', previousState: 'CONFIRMED',
    currentState: 'RUNNER', elapsedSincePriorMs: 10 * 60_000,
    price: { previous: 1, current: 1.1, changePct: 10 } }).intent, 'MOMENTUM_UPDATE');
  const scanner = await readFile(new URL('../src/chains/robinhood/existingTokenOpportunityScanner.ts', import.meta.url), 'utf8');
  assert.match(scanner, /recordCompletedExistingTokenScans\(batch\.completed/);
  assert.match(scanner, /if \(batch\.providerBackoff\)/);
});
