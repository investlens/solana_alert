import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEchoSupabaseCallbackStore } from '../src/echo/supabaseTradeCallback.js';

test('callback store hashes tokens and consumes via atomic RPC', async () => {
 let storedHash = '';
 const client = {
  from(table: string) {
   assert.equal(table, 'echo_trade_callbacks');
   return { async insert(row: { token_hash: string }) {
    storedHash = row.token_hash;
    return { error: null };
   }};
  },
  async rpc(name: string, args: { p_token_hash: string }) {
   assert.equal(name, 'echo_consume_trade_callback');
   assert.equal(args.p_token_hash, storedHash);
   return { data: [{ intent: { action: 'BUY' }, expires_at: '2030-01-01T00:00:00.000Z' }], error: null };
  },
 } as unknown as SupabaseClient;
 const store = createEchoSupabaseCallbackStore(client);
 const payload = { intent: { action: 'BUY' } as never, expiresAtMs: Date.parse('2030-01-01') };
 assert.equal(await store.insertOnce('echo_test_token', payload), true);
 assert.match(storedHash, /^[a-f0-9]{64}$/);
 assert.ok(!storedHash.includes('echo_test_token'));
 assert.deepEqual(await store.consumeOnce('echo_test_token'), payload);
});

test('database errors fail closed', async () => {
 const client = {
  from() { return { async insert() { return { error: { code: '42501' } }; } }; },
  async rpc() { return { data: null, error: { code: '42501' } }; },
 } as unknown as SupabaseClient;
 const store = createEchoSupabaseCallbackStore(client);
 await assert.rejects(() => store.insertOnce('token', { intent: {} as never, expiresAtMs: 1000 }));
 await assert.rejects(() => store.consumeOnce('token'));
});
