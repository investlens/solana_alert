import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

test('patched RPC client preserves request IDs, parameters and result parsing', async () => {
  const calls: string[] = [];
  const connection = new Connection('https://rpc.invalid', {
    commitment: 'confirmed',
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.jsonrpc, '2.0');
      assert.equal(typeof request.id, 'string');
      calls.push(request.method);
      const result = request.method === 'getBalance'
        ? { context: { slot: 1 }, value: 123456 }
        : { context: { slot: 1 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 } };
      if (request.method === 'getBalance') assert.equal(request.params[0], '11111111111111111111111111111111');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status: 200 });
    },
  });
  assert.equal(await connection.getBalance(new PublicKey('11111111111111111111111111111111')), 123456);
  assert.equal((await connection.getLatestBlockhash()).lastValidBlockHeight, 100);
  assert.deepEqual(calls, ['getBalance', 'getLatestBlockhash']);
});

test('patched SDK still signs and round-trips transactions locally without broadcasting', () => {
  const signer = Keypair.generate();
  const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: '11111111111111111111111111111111' })
    .add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  tx.sign(signer);
  assert.equal(tx.verifySignatures(), true);
  const restored = Transaction.from(tx.serialize());
  assert.equal(restored.verifySignatures(), true);
  assert.equal(restored.feePayer?.toBase58(), signer.publicKey.toBase58());
});
