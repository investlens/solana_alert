import assert from "node:assert/strict";
import test from "node:test";
import { classifyLifecycleObservation } from "../src/intelligence/lifecycleIntelligence.js";

test("does not classify a normal PONS revival before 30 minutes", () => {
  const result = classifyLifecycleObservation({
    chain: "PONS",
    tokenAddress: "test",
    ageMinutes: 29.9,
    drawdownFromHighPct: -60,
    priceChange5mPct: 12,
    buys5m: 30,
    sells5m: 3,
    creatorHoldingVerified: true,
  });
  assert.equal(result.signals.includes("REVIVAL"), false);
});

test("classifies mature reversal only with verified creator safety", () => {
  const safe = classifyLifecycleObservation({
    chain: "PONS",
    tokenAddress: "safe",
    ageMinutes: 35,
    drawdownFromHighPct: -45,
    priceChange5mPct: 8,
    buys5m: 20,
    sells5m: 5,
    creatorHoldingVerified: true,
  });
  assert.equal(safe.signals.includes("REVIVAL"), true);

  const unverified = classifyLifecycleObservation({
    chain: "PONS",
    tokenAddress: "unverified",
    ageMinutes: 35,
    drawdownFromHighPct: -45,
    priceChange5mPct: 8,
    buys5m: 20,
    sells5m: 5,
  });
  assert.equal(unverified.signals.includes("REVIVAL"), false);
});

test("classifies graduation, convergence, creator relaunch and liquidity acceleration independently", () => {
  const result = classifyLifecycleObservation({
    chain: "ROBINHOOD",
    tokenAddress: "multi",
    graduated: true,
    liquidityUsd: 30000,
    previousLiquidityUsd: 15000,
    volume5mUsd: 6000,
    buys5m: 40,
    sells5m: 10,
    uniqueSmartWalletBuyers: 3,
    creatorPriorWins: 2,
  });
  assert.deepEqual(new Set(result.signals), new Set([
    "GRADUATION_BREAKOUT",
    "WALLET_CONVERGENCE",
    "PROVEN_CREATOR_RELAUNCH",
    "LIQUIDITY_HOLDER_ACCELERATION",
  ]));
  assert.equal(result.mode, "SHADOW");
});
