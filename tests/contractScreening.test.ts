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
