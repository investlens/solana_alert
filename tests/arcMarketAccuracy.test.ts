import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichArcMarket } from '../src/chains/arc/market.js';
import { resetDexScreenerGovernorForTests } from '../src/services/dexscreenerRequestGovernor.js';
test('ARC FDV is separate from market cap and null metrics remain unknown', async () => {
  const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ chainId: 'arc', baseToken: { address },
    priceUsd: '0.0001', marketCap: null, fdv: 100000, liquidity: { usd: null }, volume: { m5: null },
    txns: { m5: { buys: 1, sells: 0 } } }]), { headers: { 'content-type': 'application/json' } });
  resetDexScreenerGovernorForTests({ fetch: globalThis.fetch });
  try {
    const result = await enrichArcMarket({ assetId: address } as any);
    assert.equal(result.marketCapUsd, null); assert.equal(result.fdvUsd, 100000);
    assert.equal(result.liquidityUsd, null); assert.equal(result.volume5mUsd, null);
    assert.equal(result.sells5m, 0); assert.equal(result.priceUsd, 0.0001);
  } finally { globalThis.fetch = original; resetDexScreenerGovernorForTests(); }
});
