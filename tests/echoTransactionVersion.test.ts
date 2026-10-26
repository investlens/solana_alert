import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readEchoTransaction } from '../src/echo/readTransaction.js';
import { extractRpcEchoSignals } from '../src/echo/rpcSignals.js';

const fixture = async () => JSON.parse(await readFile(new URL('./fixtures/echo-croakie-v1.json', import.meta.url), 'utf8'));

test('real Croakie v1 PumpSwap buy is fetched without -32015 and identified by the existing parser', async () => {
  const tx = await fixture(), signature = tx.transaction.signatures[0];
  assert.equal(tx.version, 1);
  const fetched = await readEchoTransaction(signature, async (method, params) => {
    assert.equal(method, 'getTransaction'); assert.equal(params[0], signature);
    const options = params[1] as any;
    assert.equal(options.encoding, 'jsonParsed'); assert.equal(options.commitment, 'confirmed');
    if (options.maxSupportedTransactionVersion < tx.version) throw new Error('RPC -32015: unsupported transaction version');
    return tx;
  });
  // Evaluate at historical observation time; this is not a current trading signal.
  const signals = extractRpcEchoSignals(fetched, signature, tx.blockTime + 1);
  assert.equal(signals.length, 1); assert.equal(signals[0].caller, 'Croakie'); assert.equal(signals[0].side, 'BUY');
  assert.equal(signals[0].mint, '29odnuih5B7Bo6KNNJ6VWe3VCQgEN1mvbzDWDLxbpump');
  assert.equal(signals[0].tokenAmount, 3_142_611.649012);
  assert.equal(signals[0].quoteBasis, 'wallet SOL net change; includes fees/rent');
});
test('v1 support preserves failure and freshness filters; historical buy cannot become a new alert', async () => {
  const tx = await fixture(), signature = tx.transaction.signatures[0];
  assert.deepEqual(extractRpcEchoSignals(tx, signature, tx.blockTime + 121), []);
  tx.meta.err = { InstructionError: [0, 'Custom'] };
  assert.deepEqual(extractRpcEchoSignals(tx, signature, tx.blockTime + 1), []);
});
test('v1-capable JSON request still supports legacy/v0 and propagates API failures', async () => {
  for (const version of ['legacy', 0]) {
    const result = await readEchoTransaction('signature', async (_method, params) => {
      assert.ok((params[1] as any).maxSupportedTransactionVersion >= Number(version === 'legacy' ? 0 : version));
      return { version };
    });
    assert.equal(result.version, version);
  }
  await assert.rejects(readEchoTransaction('signature', async () => { throw new Error('RPC unavailable'); }));
});
