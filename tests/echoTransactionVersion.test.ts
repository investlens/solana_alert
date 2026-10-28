import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readEchoTransaction } from '../src/echo/readTransaction.js';
import { extractRpcEchoSignals } from '../src/echo/rpcSignals.js';

const fixture = async () => JSON.parse(await readFile(new URL('./fixtures/echo-croakie-v1.json', import.meta.url), 'utf8'));

test('historical Croakie v1 transaction remains fetchable but excluded from new caller alerts', async () => {
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
  // Croakie is explicitly no longer in the active caller list. Do not
  // accidentally resurrect Croakie alerts when enabling v1 transactions.
  assert.deepEqual(signals, []);
});
test('v1 support preserves failure and freshness filters; historical buy cannot become a new alert', async () => {
  const tx = await fixture(), signature = tx.transaction.signatures[0];
  assert.deepEqual(extractRpcEchoSignals(tx, signature, tx.blockTime + 1801), []);
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
