import assert from "node:assert/strict";
import test from "node:test";

// Mirror the pure policy here so it can be validated without loading the app,
// Supabase, Telegram, RPC providers, or any production runtime dependency.
const clamp = (value) => Math.max(0, Math.min(100, value));
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
function classifyProvenWallet(stats) {
  const completed = Math.max(0, Math.floor(finite(stats.completedTrades)));
  const winRate = clamp(finite(stats.winRate));
  const avgMax = finite(stats.avgMaxReturn);
  const best = finite(stats.bestReturn);
  const realised = stats.realisedRoi == null ? null : finite(stats.realisedRoi);
  const early = stats.earlyEntryRate == null ? null : clamp(finite(stats.earlyEntryRate));
  let score = 0;
  if (completed >= 20) score += 25; else if (completed >= 10) score += 20; else if (completed >= 5) score += 12;
  if (winRate >= 65) score += 30; else if (winRate >= 50) score += 20; else if (winRate >= 40) score += 10;
  if (avgMax >= 150) score += 25; else if (avgMax >= 75) score += 18; else if (avgMax >= 30) score += 8;
  if (best >= 500) score += 10; else if (best >= 200) score += 6;
  if (realised != null) { if (realised >= 75) score += 10; else if (realised < 0) score -= 10; }
  if (early != null && early >= 50) score += 5;
  score = Math.round(clamp(score));
  return { proven: completed >= 5 && winRate >= 50 && avgMax >= 30 && (realised == null || realised >= 0) && score >= 70, score };
}
const walletConvergenceKey = (token, wallet) => `${token.trim().toLowerCase()}:${wallet.trim().toLowerCase()}`;

test("one moonshot is not enough", () => assert.equal(classifyProvenWallet({completedTrades:1,winRate:100,avgMaxReturn:1200,bestReturn:1200}).proven,false));
test("repeatable profitable history qualifies", () => assert.equal(classifyProvenWallet({completedTrades:12,winRate:67,avgMaxReturn:110,bestReturn:650,realisedRoi:90,earlyEntryRate:60}).proven,true));
test("negative realised performance blocks proven status", () => assert.equal(classifyProvenWallet({completedTrades:20,winRate:70,avgMaxReturn:180,bestReturn:900,realisedRoi:-15}).proven,false));
test("convergence identity normalizes addresses", () => assert.equal(walletConvergenceKey(" 0xABC "," 0xDEF "),"0xabc:0xdef"));
