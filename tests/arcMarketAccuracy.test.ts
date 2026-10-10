import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichArcMarket } from '../src/chains/arc/market.js';
import { resetDexScreenerGovernorForTests } from '../src/services/dexscreenerRequestGovernor.js';
test('ARC FDV is separate from market cap and null metrics remain unknown', async () => {
  const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ chainId: 'arc', baseToken: { address }, pairAddress: '0x' + '1'.repeat(64),
    priceUsd: '0.0001', marketCap: null, fdv: 100000, liquidity: { usd: null }, volume: { m5: null },
    txns: { m5: { buys: 1, sells: 0 } } }]), { headers: { 'content-type': 'application/json' } });
  resetDexScreenerGovernorForTests({ fetch: globalThis.fetch });
  try {
    const result = await enrichArcMarket({ assetId: address, poolId: '0x' + '1'.repeat(64) } as any);
    assert.equal(result.marketCapUsd, null); assert.equal(result.fdvUsd, 100000);
    assert.equal(result.liquidityUsd, null); assert.equal(result.volume5mUsd, null);
    assert.equal(result.sells5m, 0); assert.equal(result.priceUsd, 0.0001);
  } finally { globalThis.fetch = original; resetDexScreenerGovernorForTests(); }
});

test('ARC binds valuation to candidate pool instead of borrowing another pool liquidity', async () => {
  const address = '0x' + 'a'.repeat(40); const poolId = '0x' + 'b'.repeat(64);
  const original = globalThis.fetch;
  const pair = (id: string, liquidity: number) => ({ chainId: 'arc', pairAddress: id, baseToken: { address }, liquidity: { usd: liquidity }, marketCap: liquidity * 3 });
  globalThis.fetch = async () => new Response(JSON.stringify([pair('0x' + 'c'.repeat(64), 25000), pair(poolId.toUpperCase(), 1.33)]), { headers: { 'content-type': 'application/json' } });
  resetDexScreenerGovernorForTests({ fetch: globalThis.fetch });
  try {
    const result = await enrichArcMarket({ assetId: address, poolId, hooks: '0x' + '0'.repeat(40) } as any);
    assert.equal(result.liquidityUsd, 1.33); assert.equal(result.marketCapUsd, 3.99);
    assert.equal(result.poolId, poolId);
  } finally { globalThis.fetch = original; resetDexScreenerGovernorForTests(); }
});

test('ARC missing or mismatched pool identity cannot acquire market evidence', async () => {
  const address = '0x' + 'a'.repeat(40); const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ chainId: 'arc', pairAddress: '0x' + 'c'.repeat(64), baseToken: { address }, liquidity: { usd: 25000 } }]), { headers: { 'content-type': 'application/json' } });
  resetDexScreenerGovernorForTests({ fetch: globalThis.fetch });
  try {
    for (const poolId of [undefined, '0x' + 'b'.repeat(64)]) {
      const result = await enrichArcMarket({ assetId: address, poolId } as any);
      assert.equal(result.marketDataSource, null); assert.equal(result.liquidityUsd, null);
    }
  } finally { globalThis.fetch = original; resetDexScreenerGovernorForTests(); }
});

test('ARC valuation parser preserves unknown and genuine zero separately', async () => {
  const { arcMarketNumber } = await import('../src/chains/arc/market.js');
  for (const value of [null, undefined, '', ' ', NaN, -1]) assert.equal(arcMarketNumber(value), null);
  assert.equal(arcMarketNumber(0), 0); assert.equal(arcMarketNumber('12000'), 12000);
});

test('unindexed ARC pools yield checks until cooldown expiry then recover with exact-pool data', async () => {
  const { arcMarketRetryAt } = await import('../src/chains/arc/market.js');
  const address='0x'+'d'.repeat(40); const poolId='0x'+'e'.repeat(64);
  const original=globalThis.fetch; const originalNow=Date.now;
  let clock=originalNow();let calls=0;let indexed=false;Date.now=()=>clock;
  const request:typeof fetch=async()=>{calls++;return new Response(JSON.stringify(indexed ? [{chainId:'arc',baseToken:{address},pairAddress:poolId,marketCap:1000}] : []));};
  resetDexScreenerGovernorForTests({fetch:request});
  try {
    const token={assetId:address,poolId} as any;
    assert.equal((await enrichArcMarket(token)).marketDataSource,null);
    const initialCalls=calls;assert.equal(arcMarketRetryAt(token),clock+60_000);
    clock+=15_000;await enrichArcMarket(token);assert.equal(calls,initialCalls);
    indexed=true;clock+=45_001;
    const recovered=await enrichArcMarket(token);assert.equal(recovered.marketDataSource,'DEXSCREENER');assert.equal(recovered.marketCapUsd,1000);
  } finally {globalThis.fetch=original;Date.now=originalNow;resetDexScreenerGovernorForTests();}
});

test('ARC native/system addresses never qualify for ERC20 burn reads', async () => {
  const { isArcErc20LogAddress }=await import('../src/chains/arc/candidate.js');
  for(const address of ['0xfffffffffffffffffffffffffffffffffffffffe','0x'+'0'.repeat(40),'garbage']) assert.equal(isArcErc20LogAddress(address),false);
  assert.equal(isArcErc20LogAddress('0x'+'a'.repeat(40)),true);
});
