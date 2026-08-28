import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessExistingTokenObservation, buildExistingTokenUniverse, existingTokenObservationIsSeparated, existingTokenPersistedState, selectDueExistingTokens } from '../src/chains/robinhood/existingTokenOpportunityScanner.js';

const now = Date.parse('2026-08-28T12:00:00.000Z');
const observations = [
  { observedAt: '2026-08-28T11:55:00.000Z', roi: 0, price: 1, volume5m: 100, liquidity: 10_000, buys5m: 10, sells5m: 5 },
  { observedAt: '2026-08-28T11:57:00.000Z', roi: 10, price: 1.1, volume5m: 120, liquidity: 10_500, buys5m: 12, sells5m: 6 },
] as any;

describe('existing-token continuous opportunity scanner', () => {
  it('keeps a five-hour existing token in the bounded 24h universe without BOOST or DEX Paid', () => {
    const universe = buildExistingTokenUniverse({ now, observations: [{ token_address: '0xABC', updated_at: '2026-08-28T07:00:00.000Z' }] });
    assert.deepEqual(universe, [{ token: '0xabc', tier: 'WARM', lastSeenAt: '2026-08-28T07:00:00.000Z', watched: false }]);
  });

  it('ages inactive tokens out but retains explicitly watched tokens', () => {
    assert.equal(buildExistingTokenUniverse({ now, observations: [{ token_address: '0xold', updated_at: '2026-08-26T00:00:00.000Z' }] }).length, 0);
    assert.equal(buildExistingTokenUniverse({ now, opportunities: [{ asset_id: '0xmonitor', strategy_key: 'EXISTING_TOKEN_MONITOR', status: 'WATCHING', updated_at: '2026-08-26T00:00:00.000Z' }] }).length, 0);
    assert.equal(buildExistingTokenUniverse({ now, watched: [{ opportunities: { asset_id: '0xOLD', chain: 'robinhood' }, updated_at: '2026-08-26T00:00:00.000Z' }] }).length, 1);
    assert.equal(buildExistingTokenUniverse({ now, opportunities: [{ asset_id: '0xrunner', strategy_key: 'EXISTING_TOKEN_RUNNER', status: 'NEW', updated_at: '2026-08-26T00:00:00.000Z' }] }).length, 1);
  });

  it('requires sustained comparable 1.5x volume and a meaningful transition before alerting', () => {
    const result = assessExistingTokenObservation({ prior: { state: 'BUILDING', observations }, observedAt: '2026-08-28T12:00:00.000Z',
      price: 1.2, marketCap: 120_000, liquidity: 11_000, volume5m: 160, buys5m: 15, sells5m: 7 });
    assert.equal(result.assessment.volumeSurge, true);
    assert.equal(result.assessment.state, 'CONFIRMED');
    assert.equal(result.transition, true);
    assert.equal(result.alertable, true);
  });

  it('enforces persisted HOT/WARM observation separation across process restarts', () => {
    const persisted = [{ observedAt: '2026-08-28T11:59:30.000Z', roi: 2, volume5m: 4_000 }];
    assert.equal(existingTokenObservationIsSeparated(persisted, '2026-08-28T12:00:00.000Z', 60), false);
    assert.equal(existingTokenObservationIsSeparated(persisted, '2026-08-28T12:00:30.000Z', 60), true);
    assert.equal(existingTokenObservationIsSeparated(persisted, '2026-08-28T12:02:29.000Z', 180), false);
    assert.equal(existingTokenObservationIsSeparated(persisted, '2026-08-28T12:02:30.000Z', 180), true);
  });

  it('does not alert merely because unchanged BUILDING structure was scanned', () => {
    const result = assessExistingTokenObservation({ prior: { state: 'BUILDING', observations }, observedAt: '2026-08-28T12:00:00.000Z',
      price: 1.15, marketCap: 115_000, liquidity: 10_500, volume5m: 130, buys5m: 12, sells5m: 7 });
    assert.equal(result.assessment.state, 'BUILDING');
    assert.equal(result.transition, false);
    assert.equal(result.alertable, false);
  });

  it('does not resend unchanged persisted CONFIRMED structure after cooldown expiry', () => {
    const prior = { intelligenceState: 'CONFIRMED' as const, lastAlertAt: '2026-08-28T11:40:00.000Z', observations };
    assert.equal(existingTokenPersistedState(prior), 'CONFIRMED');
    const result = assessExistingTokenObservation({ prior, observedAt: '2026-08-28T12:00:00.000Z',
      price: 1.2, marketCap: 120_000, liquidity: 11_000, volume5m: 160, buys5m: 15, sells5m: 7 });
    assert.equal(result.assessment.state, 'RUNNER');
    assert.equal(result.transition, true);
    const unchangedRunner = assessExistingTokenObservation({ prior: { ...prior, intelligenceState: 'RUNNER', observations: result.history },
      observedAt: '2026-08-28T12:03:00.000Z', price: 1.2, marketCap: 120_000, liquidity: 11_000, volume5m: 160, buys5m: 15, sells5m: 7 });
    assert.equal(unchangedRunner.assessment.state, 'RUNNER');
    assert.equal(unchangedRunner.transition, false);
    assert.equal(unchangedRunner.alertable, true);
  });

  it('allows a genuine COOLING recovery to become reignition', () => {
    const result = assessExistingTokenObservation({ prior: { state: 'COOLING', observations }, observedAt: '2026-08-28T12:00:00.000Z',
      price: 1.2, marketCap: 120_000, liquidity: 12_000, volume5m: 170, buys5m: 18, sells5m: 6 });
    assert.equal(result.reentry, true);
    assert.equal(result.alertable, true);
  });

  it('caps each cycle and reserves capacity so WARM tokens cannot be permanently starved', () => {
    const universe = [
      ...Array.from({ length: 30 }, (_, i) => ({ token: `0xhot${i}`, tier: 'HOT' as const, lastSeenAt: new Date(now).toISOString() })),
      ...Array.from({ length: 3 }, (_, i) => ({ token: `0xwarm${i}`, tier: 'WARM' as const, lastSeenAt: new Date(now).toISOString() })),
    ];
    const first = selectDueExistingTokens(universe, { now, max: 25, lastScanned: new Map(), warmStart: 0 });
    const second = selectDueExistingTokens(universe, { now, max: 25, lastScanned: new Map(first.selected.map(x => [x.token, now])), warmStart: first.nextWarmCursor });
    assert.equal(first.selected.length, 25);
    assert.equal(first.selected.some(x => x.token === '0xwarm0'), true);
    assert.equal(second.selected.some(x => x.token === '0xwarm1'), true);
    const allDueAgain = selectDueExistingTokens(universe, { now, max: 25, lastScanned: new Map(), hotStart: first.nextHotCursor, warmStart: first.nextWarmCursor });
    assert.equal(allDueAgain.selected.some(x => x.token === '0xhot24'), true);
  });
});
