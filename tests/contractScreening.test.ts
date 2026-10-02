import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScanContract, renderContractScreen } from '../src/bot/contractScreening.js';
const token = '0x1111111111111111111111111111111111111111';
test('contract scans reject partial, embedded and multiple addresses', () => {
  assert.equal(extractScanContract(`/scan robinhood ${token}`), token);
  assert.equal(extractScanContract(`a${token}`), null);
  assert.equal(extractScanContract(`${token}0`), null);
  assert.equal(extractScanContract(`${token} ${token}`), null);
});
test('scan card preserves genuine zero, hides missing metrics and separates FDV', () => {
  const text = renderContractScreen(token, { baseToken: { name: '<Fake>', symbol: 'TEST' }, priceUsd: '0.0001', fdv: 12000,
    txns: { m5: { buys: 5, sells: 0 } } });
  assert.match(text, /&lt;Fake&gt;/);
  assert.match(text, /FDV.*12.0K/);
  assert.doesNotMatch(text, /MC  |Vol · 5m|LP liquidity|ATH|DEX Paid/);
  assert.match(text, /5 buy \/ 0 sell/);
  assert.match(text, /not assessed/);
  assert.ok(text.length <= 1024);
});
test('unsupported market data yields one clear explanation, never a green safety claim', () => {
  const text = renderContractScreen(token, null);
  assert.match(text, /could not be verified/);
  assert.doesNotMatch(text, /SAFE|VERIFIED|\$0|Unverified\n.*Unverified/);
});
test('pre-bond PONS snapshot supplies identity, price and supply without inventing market cap or liquidity', () => {
  const text = renderContractScreen(token, null, { name: 'Launch', symbol: 'NEW', creator: token,
    decimals: 18, totalSupplyRaw: 1_000_000n * 10n ** 18n, priceUsd: 1e-10, fdvUsd: 0.0001,
    twitter: null, telegram: null });
  assert.match(text, /PONS snapshot · DEX market not indexed/);
  assert.match(text, /1\.0000e-10/); assert.match(text, /Total supply.*1,000,000/);
  assert.doesNotMatch(text, /MC  |LP liquidity|ATH/); assert.ok(text.length <= 1024);
});
test('signed hourly change and genuine zero volume remain truthful in a bounded caption', () => {
  const text = renderContractScreen(token, { baseToken: { name: '<'.repeat(60), symbol: '<'.repeat(24) },
    priceUsd: '0.000001', marketCap: 50000, liquidity: { usd: 20000 }, volume: { m5: 0, h24: 12345 },
    priceChange: { h1: -25.5 }, txns: { m5: { buys: 0, sells: 1 } } });
  assert.match(text, /Move · 1h.*-25\.50%/); assert.match(text, /Vol · 24h/);
  assert.match(text, /Vol · 5m.*0/); assert.ok(text.length <= 1024);
});
