import test from 'node:test';
import assert from 'node:assert/strict';
import { locateWalletNonceBlocks } from '../src/chains/robinhood/walletNonceLocator.js';

test('an inactive wallet requires no full blocks or historical nonce reads', async () => {
  const result = await locateWalletNonceBlocks({ from: 0n, to: 100000n, before: 10n, after: 10n, nonceAt: async () => { throw Error('unnecessary read'); } });
  assert.deepEqual(result, { blocks: [], reads: 0, throughBlock: 100000n, complete: true });
});
test('binary search locates exact transaction blocks including several transactions in one block', async () => {
  const result = await locateWalletNonceBlocks({ from: 100n, to: 1000n, before: 2n, after: 6n,
    nonceAt: async block => block < 401n ? 2n : block < 807n ? 5n : 6n });
  assert.deepEqual(result.blocks, [401n, 807n]); assert.equal(result.complete, true); assert.ok(result.reads <= 24);
});
test('bounded scans advance only through the completed prefix', async () => {
  const result = await locateWalletNonceBlocks({ from: 0n, to: 100n, before: 0n, after: 10n, maxBlocks: 2,
    nonceAt: async block => block / 10n });
  assert.deepEqual(result.blocks, [10n, 20n]); assert.equal(result.complete, false); assert.ok(result.throughBlock < 30n);
});
test('reorgs and inconsistent provider state never authorize checkpoint advancement', async () => {
  await assert.rejects(locateWalletNonceBlocks({ from: 0n, to: 100n, before: 5n, after: 4n, nonceAt: async () => 4n }), /decreased/);
  await assert.rejects(locateWalletNonceBlocks({ from: 0n, to: 100n, before: 2n, after: 4n, nonceAt: async () => 9n }), /Inconsistent/);
});
