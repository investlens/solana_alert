import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEther, type Address } from 'viem';
import { modelPosition, type PositionCheck } from '../src/services/positionCheckService.js';
import type { PonsV2CurveState } from '../src/chains/robinhood/ponsV2CurveQuote.js';
import { renderPositionCheck, positionCheckButtons } from '../src/ui/positionCheckView.js';

const address = ('0x' + '1'.repeat(40)) as Address;
const state: PonsV2CurveState = { tokenAddress: address, curveAddress: address, pairToken: ('0x' + '0'.repeat(40)) as Address,
  nativeQuote: true, quoteReserve: parseEther('1'), tokenReserve: parseEther('1000000'),
  sellableTokens: parseEther('800000'), reservedTokens: parseEther('200000'), feeBps: 100n, creatorTaxBps: 100n, graduated: false };
test('larger positions have greater impact; fee-bearing round trips recover less than spend', () => {
  const small = modelPosition(state, '0.001', 18), large = modelPosition(state, '0.05', 18);
  assert.ok(large.priceImpactPct > small.priceImpactPct);
  assert.ok(Number(large.recoveredEth) < Number(large.spentEth));
  assert.ok(large.roundTripLossPct > 0); assert.ok(Number(large.buyFeeEth) > 0); assert.ok(Number(large.sellFeeEth) > 0);
});
test('zero fees round-trip returns principal within integer rounding without assuming profit', () => {
  const quote = modelPosition({ ...state, feeBps: 0n, creatorTaxBps: 0n }, '0.01', 18);
  assert.ok(Math.abs(Number(quote.spentEth) - Number(quote.recoveredEth)) < 1e-12);
});
test('allocation boundaries, unsupported and invalid curves are rejected', () => {
  assert.throws(() => modelPosition({ ...state, sellableTokens: parseEther('10') }, '0.05', 18), /Allocation boundary/);
  for (const patch of [{ nativeQuote: false }, { graduated: true }, { feeBps: 10000n }, { feeBps: -1n }, { quoteReserve: 0n }]) {
    assert.throws(() => modelPosition({ ...state, ...patch }, '0.01', 18));
  }
});
test('unavailable data stays explicit and callbacks remain below Telegram limit', () => {
  const check: PositionCheck = { token: address, size: '0.01', checkedAt: Date.now(), block: null, quote: null, holders: null, creator: null, setup: null, reason: 'Source <unavailable>' };
  const text = renderPositionCheck(check);
  assert.match(text, /Unable to assess execution/); assert.match(text, /Source &lt;unavailable&gt;/);
  assert.match(text, /Holder concentration.*Unable to assess/); assert.doesNotMatch(text, /0\.00%|SAFE|APPROVED/);
  for (const row of positionCheckButtons(address)) for (const button of row) if ('callback_data' in button) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
});
test('estimates disclose model assumptions, excluded gas and holder sample limitations', () => {
  const text = renderPositionCheck({ token: address, size: '0.01', checkedAt: Date.now(), block: '123',
    reason: null, quote: modelPosition(state, '0.01', 18), creator: null, setup: { belowLow: true, at: Date.now() },
    holders: { top10: 12, largest: 3, sampled: 20, excluded: 2, at: Date.now() } });
  assert.match(text, /CURVE MODEL ESTIMATE/); assert.match(text, /Gas excluded/); assert.match(text, /total supply/);
  assert.match(text, /complete ownership and linked wallets unverified/); assert.match(text, /BROKEN/);
  assert.ok(text.length < 3000);
});
