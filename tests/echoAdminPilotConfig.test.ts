import { describe, expect, it } from 'vitest';
import { ECHO_ADMIN_PILOT, evaluateEchoAdminPilot } from '../src/echo/adminPilotConfig';

const good = {
  callerWallet: ECHO_ADMIN_PILOT.callerWallets[0], side: 'BUY' as const,
  verifiedSwap: true, amountSol: 0.1, slippageBps: 300,
  openPositions: 0, dailyRealizedLossSol: 0,
  alreadyReserved: false, adminAuthorized: true,
};
describe('Echo admin pilot (shadow only)', () => {
  it('cannot execute and cannot auto sell', () => {
    expect(ECHO_ADMIN_PILOT.executionEnabled).toBe(false);
    expect(ECHO_ADMIN_PILOT.automaticSellEnabled).toBe(false);
    expect(ECHO_ADMIN_PILOT.autoSell).toBe(false);
  });
  it('admits only verified BUY from Slingoor or Chairman in shadow evaluation', () => {
    for (const callerWallet of ECHO_ADMIN_PILOT.callerWallets)
      expect(evaluateEchoAdminPilot({ ...good, callerWallet }).eligibleForFutureActivation).toBe(true);
    expect(evaluateEchoAdminPilot({ ...good, side: 'SELL' }).eligibleForFutureActivation).toBe(false);
    expect(evaluateEchoAdminPilot({ ...good, verifiedSwap: false }).eligibleForFutureActivation).toBe(false);
    expect(evaluateEchoAdminPilot({ ...good, callerWallet: 'other' }).eligibleForFutureActivation).toBe(false);
  });
  it('enforces admin, dedupe, spending, slippage, position and loss limits', () => {
    for (const overrides of [
      { adminAuthorized: false }, { alreadyReserved: true }, { amountSol: 0.10001 },
      { slippageBps: 301 }, { openPositions: 2 }, { dailyRealizedLossSol: 0.15 },
      { amountSol: NaN }, { slippageBps: Infinity }, { openPositions: -1 },
    ]) expect(evaluateEchoAdminPilot({ ...good, ...overrides }).eligibleForFutureActivation).toBe(false);
  });
});
