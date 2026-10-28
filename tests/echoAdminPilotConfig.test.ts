import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ECHO_ADMIN_PILOT, evaluateEchoAdminPilot } from '../src/echo/adminPilotConfig.js';

const good = {
  callerWallet: ECHO_ADMIN_PILOT.callerWallets[0], side: 'BUY' as const,
  verifiedSwap: true, amountSol: 0.1, slippageBps: 300,
  openPositions: 0, dailyRealizedLossSol: 0,
  alreadyReserved: false, adminAuthorized: true,
};
describe('Echo admin pilot (shadow only)', () => {
  it('cannot execute and cannot auto sell', () => {
    assert.equal(ECHO_ADMIN_PILOT.executionEnabled, false);
    assert.equal(ECHO_ADMIN_PILOT.automaticSellEnabled, false);
    assert.equal(ECHO_ADMIN_PILOT.autoSell, false);
  });
  it('admits only verified BUY from Slingoor or Chairman in shadow evaluation', () => {
    for (const callerWallet of ECHO_ADMIN_PILOT.callerWallets)
      assert.equal(evaluateEchoAdminPilot({ ...good, callerWallet }).eligibleForFutureActivation, true);
    assert.equal(evaluateEchoAdminPilot({ ...good, side: 'SELL' }).eligibleForFutureActivation, false);
    assert.equal(evaluateEchoAdminPilot({ ...good, verifiedSwap: false }).eligibleForFutureActivation, false);
    assert.equal(evaluateEchoAdminPilot({ ...good, callerWallet: 'other' }).eligibleForFutureActivation, false);
  });
  it('enforces admin, dedupe, spending, slippage, position and loss limits', () => {
    for (const overrides of [
      { adminAuthorized: false }, { alreadyReserved: true }, { amountSol: 0.10001 },
      { slippageBps: 301 }, { openPositions: 2 }, { dailyRealizedLossSol: 0.15 },
      { amountSol: NaN }, { slippageBps: Infinity }, { openPositions: -1 },
    ]) assert.equal(evaluateEchoAdminPilot({ ...good, ...overrides }).eligibleForFutureActivation, false);
  });
});
