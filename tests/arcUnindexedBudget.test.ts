import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichArcMarket } from '../src/chains/arc/market.js';
import { resetDexScreenerGovernorForTests } from '../src/services/dexscreenerRequestGovernor.js';
test('unindexed ARC pools wait before repeating scoped and fallback requests', async () => {
 let calls=0;
 resetDexScreenerGovernorForTests({fetch:async()=>{calls++;return Response.json([]);}});
 const token={assetId:'0x'+'9'.repeat(40),poolId:'0x'+'8'.repeat(64)} as any;
 try {
  assert.equal((await enrichArcMarket(token)).marketDataSource,null);
  assert.equal(calls,2);
  // Reset the provider cache to prove the candidate-level bound remains effective.
  resetDexScreenerGovernorForTests({fetch:async()=>{calls++;return Response.json([]);}});
  assert.equal((await enrichArcMarket(token)).marketDataSource,null);
  assert.equal(calls,2);
 } finally {resetDexScreenerGovernorForTests();}
});
