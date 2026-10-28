import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExecutionGate, type ExecutionSnapshot } from '../src/echo/adminExecutionGate.js';
const good: ExecutionSnapshot = {
  callerWallet: '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
  side: 'BUY', verifiedSwap: true, amountSol: 0.1, slippageBps: 300,
  openPositions: 0, dailyRealizedLossSol: 0, alreadyReserved: false, adminAuthorized: true,
  databaseHealthy: true, signerHealthy: true, rpcHealthy: true, reconciliationHealthy: true,
  emergencyStop: false, quoteAgeMs: 100, maxQuoteAgeMs: 1000, expectedFeeLamports: 5000,
  maxFeeLamports: 1000000, availableSol: 0.3, minSolReserve: 0.05,
  priceImpactBps: 100, observedPriceMoveBps: 50, maxObservedPriceMoveBps: 100,
  liquidityUsd: 20000, minimumLiquidityUsd: 5000, sellRouteVerified: true,
  tokenSafetyVerified: true, tokenMint: 'So11111111111111111111111111111111111111112',
  executionWallet: '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
  callerSignature: '5W5d2xZT8K2QTmpixHviNrt5E38esAhqmjNVfqxmfm4Jz8RoEfwsW6efsEJ6ptxT1tj5sxeGFj8UicopFP5TT3Ed',
  eventAgeMs: 100, maxEventAgeMs: 3000, dailySpendSol: 0, maxDailySpendSol: 0.2,
  dailyMarkedLossSol: 0, lossMarkFresh: true,
};
describe('Echo shadow execution gate', () => {
  it('cannot enable live execution even for passing conditions', () => {
    const decision = evaluateExecutionGate(good);
    assert.equal(decision.readyForShadow, true);
    assert.equal(decision.liveExecutionAllowed, false);
  });
  it('fails closed for unsafe, stale or unauthenticated conditions', () => {
    const invalid: Partial<ExecutionSnapshot>[] = [
      { adminAuthorized: false }, { alreadyReserved: true }, { openPositions: 2 },
      { emergencyStop: true }, { databaseHealthy: false }, { signerHealthy: false },
      { rpcHealthy: false }, { reconciliationHealthy: false }, { lossMarkFresh: false },
      { dailyMarkedLossSol: 0.15 }, { quoteAgeMs: 1001 }, { eventAgeMs: 3001 },
      { expectedFeeLamports: 1000001 }, { availableSol: 0.1 }, { liquidityUsd: 4999 },
      { sellRouteVerified: false }, { tokenSafetyVerified: false }, { priceImpactBps: 301 },
      { observedPriceMoveBps: 101 }, { dailySpendSol: 0.2 }, { tokenMint: 'bad' },
      { availableSol: Number.NaN }, { liquidityUsd: Number.POSITIVE_INFINITY },
    ];
    for (const change of invalid) {
      const d = evaluateExecutionGate({ ...good, ...change });
      assert.equal(d.readyForShadow, false, JSON.stringify(change));
      assert.equal(d.liveExecutionAllowed, false);
    }
  });
});
