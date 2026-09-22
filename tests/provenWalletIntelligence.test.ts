import assert from "node:assert/strict";
import test from "node:test";
import { classifyProvenWallet, walletConvergenceKey } from "../src/intelligence/provenWalletIntelligence.js";

test("requires repeatability rather than one large winner", () => {
  assert.equal(classifyProvenWallet({ completedTrades: 1, winRate: 100, avgMaxReturn: 1200, bestReturn: 1200 }).proven, false);
});

test("promotes repeatable profitable history", () => {
  const result = classifyProvenWallet({ completedTrades: 12, winRate: 67, avgMaxReturn: 110, bestReturn: 650, realisedRoi: 90, earlyEntryRate: 60 });
  assert.equal(result.proven, true);
  assert.equal(result.tier, "PROVEN");
});

test("does not call a wallet proven when realised performance is negative", () => {
  assert.equal(classifyProvenWallet({ completedTrades: 20, winRate: 70, avgMaxReturn: 180, bestReturn: 900, realisedRoi: -15 }).proven, false);
});

test("normalizes convergence identities", () => {
  assert.equal(walletConvergenceKey(" 0xABC ", " 0xDEF "), "0xabc:0xdef");
});
