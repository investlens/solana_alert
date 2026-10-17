import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters } from 'viem';
import { inspectDemandReceipt } from '../src/services/demandReceiptEvidence.js';
const token = '0x' + '1'.repeat(40), manager = '0x' + '2'.repeat(40), trader = '0x' + '3'.repeat(40), recipient = '0x' + '4'.repeat(40);
const txHash = '0x' + 'a'.repeat(64), poolId = '0x' + 'b'.repeat(64), blockHash = '0x' + 'c'.repeat(64);
const abi = parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
function fixture(to = recipient) {
  const base = { transactionHash: txHash, blockHash, blockNumber: '0x10', removed: false };
  const swap = { ...base, address: manager, logIndex: '0x1',
    topics: encodeEventTopics({ abi, eventName: 'Swap', args: { id: poolId as any, sender: manager as any } }),
    data: encodeAbiParameters(parseAbiParameters('int128,int128,uint160,uint128,int24,uint24'), [-100n, 1000n, 1n, 1n, 0, 2500]) };
  const transfer = { ...base, address: token, logIndex: '0x2',
    topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: manager as any, to: to as any } }),
    data: encodeAbiParameters(parseAbiParameters('uint256'), [960n]) };
  return { token, poolId, manager, trader, txHash, logIndex: 1, tokenIs0: false, side: 'buy' as const,
    receipt: { transactionHash: txHash, blockHash, blockNumber: '0x10', from: trader, status: '0x1', logs: [swap, transfer] } };
}
test('matching routed buy does not establish the initiator as token beneficiary', () => {
  const r = inspectDemandReceipt(fixture())!;
  assert.equal(r.matchedSwap, true); assert.equal(r.swapTokenRaw, '1000');
  assert.equal(r.initiatorNetTokenRaw, '0'); assert.equal(r.initiatorReceivedNetTokens, false);
  assert.equal(r.beneficiaryOwnership, 'UNVERIFIED'); assert.equal(r.eligibleForAlert, false);
});
test('gross pool output and net initiator receipt remain distinct even on direct buys', () => {
  const r = inspectDemandReceipt(fixture(trader))!;
  assert.equal(r.swapTokenRaw, '1000'); assert.equal(r.initiatorNetTokenRaw, '960');
  assert.equal(r.initiatorReceivedNetTokens, true); assert.equal(r.eligibleForAlert, false);
});
test('wrong transaction, pool, direction, index and manager all fail closed', () => {
  for (const change of [{ txHash: poolId }, { poolId: txHash }, { side: 'sell' }, { logIndex: 2 },
    { manager: token }, { tokenIs0: true }, { tokenIs0: undefined }]) {
    assert.equal(inspectDemandReceipt({ ...fixture(), ...change } as any), null);
  }
  const f = fixture(); assert.equal(inspectDemandReceipt({ ...f, receipt: { ...f.receipt, status: '0x0' } }), null);
});
test('duplicate, removed, oversized and mismatched-block receipt logs are rejected', () => {
  const f = fixture(), logs = f.receipt.logs;
  for (const altered of [[...logs, logs[0]], [{ ...logs[0], removed: true }, logs[1]],
    [{ ...logs[0], blockHash: txHash }, logs[1]], [{ ...logs[0], blockNumber: '0x11' }, logs[1]],
    Array(257).fill(logs[0])]) {
    assert.equal(inspectDemandReceipt({ ...f, receipt: { ...f.receipt, logs: altered } }), null);
  }
});
