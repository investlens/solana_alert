import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSetupTrend, creatorSetupEligible, emptySetupTrend } from '../src/chains/robinhood/tradeSetupEvidence.js';

test('breakout needs spaced price and reserve growth, and is labelled separately', () => {
  const state = emptySetupTrend();
  assert.equal(advanceSetupTrend(state,{at:0,price:100,quoteDepth:10}),false);
  assert.equal(advanceSetupTrend(state,{at:60000,price:102,quoteDepth:10.1}),false);
  assert.equal(advanceSetupTrend(state,{at:120000,price:104,quoteDepth:10.4}),true);
  assert.equal(state.setupKind,'BREAKOUT');
  const flatDepth=emptySetupTrend();
  [100,104,108].forEach((price,i)=>assert.equal(advanceSetupTrend(flatDepth,{at:i*60000,price,quoteDepth:10}),false));
});
test('pullback requires two spaced recoveries and rising reserve evidence', () => {
  const state = emptySetupTrend();
  assert.equal(advanceSetupTrend(state, { at: 0, price: 100, quoteDepth: 10 }), false);
  assert.equal(advanceSetupTrend(state, { at: 60_000, price: 95, quoteDepth: 9 }), false);
  assert.equal(advanceSetupTrend(state, { at: 120_000, price: 97, quoteDepth: 9.1 }), false);
  assert.equal(advanceSetupTrend(state, { at: 180_000, price: 99, quoteDepth: 9.2 }), true);
});
test('withdrawals, stale gaps, duplicate timestamps and invalid samples cannot confirm', () => {
  for (const scenario of ['withdrawal', 'gap', 'duplicate', 'invalid']) {
    const state = emptySetupTrend();
    advanceSetupTrend(state, { at: 0, price: 100, quoteDepth: 10 });
    advanceSetupTrend(state, { at: 60_000, price: 95, quoteDepth: 9 });
    advanceSetupTrend(state, { at: 120_000, price: 97, quoteDepth: 9.1 });
    assert.equal(advanceSetupTrend(state, { at: scenario === 'gap' ? 400_000 : scenario === 'duplicate' ? 120_000 : 180_000,
      price: scenario === 'invalid' ? NaN : 99, quoteDepth: scenario === 'withdrawal' ? 8 : 9.2 }), false);
  }
});
test('creator gating rejects missing transfer evidence, stale scans and actual movement', () => {
  const valid = { status: 'COMPLETE', holding: 2, burned: 0, moved: 0, scannedAt: 1_000 };
  assert.equal(creatorSetupEligible(valid, 2_000), true);
  for (const change of [{ status: 'BALANCES_ONLY' }, { moved: null }, { moved: 0.1 }, { holding: null }, { holding: NaN }, { scannedAt: -100_000 }, { scannedAt: -400_000 }]) {
    assert.equal(creatorSetupEligible({ ...valid, ...change }, 2_000), false);
  }
  assert.equal(creatorSetupEligible({ ...valid, holding: 0, burned: 1 }, 2_000), true);
});
