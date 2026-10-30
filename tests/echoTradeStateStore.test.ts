import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { advanceEchoTradeState } from '../src/echo/tradeStateStore.js';
function fakeStore(rows: unknown[], error: unknown = null): SupabaseClient {
 const chain = {
  update(_row: unknown) { return chain; },
  eq(_field: string, _value: string) { return chain; },
  async select(_fields: string) { return { data: rows, error }; },
 };
 return { from(table: string) { assert.equal(table, 'echo_live_buy_intents'); return chain; } } as unknown as SupabaseClient;
}
test('compare-and-swap accepts one matching transition', async () => {
 const result = await advanceEchoTradeState(fakeStore([{ state: 'signed' }]), 'wallet', 'mint', 'reserved', 'SIGNED_DURABLY');
 assert.deepEqual(result, { advanced: true, state: 'signed' });
});
test('missing row, conflicting update and storage errors fail closed', async () => {
 assert.equal((await advanceEchoTradeState(fakeStore([]), 'wallet', 'mint', 'reserved', 'SIGNED_DURABLY')).reason, 'STATE_CONFLICT');
 assert.equal((await advanceEchoTradeState(fakeStore([{ state: 'signed' }, { state: 'signed' }]), 'wallet', 'mint', 'reserved', 'SIGNED_DURABLY')).reason, 'STATE_CONFLICT');
 assert.equal((await advanceEchoTradeState(fakeStore([], { code: '42501' }), 'wallet', 'mint', 'reserved', 'SIGNED_DURABLY')).reason, 'STORAGE_UNAVAILABLE');
 assert.equal((await advanceEchoTradeState(fakeStore([]), 'wallet', 'mint', 'confirmed', 'SIGNED_DURABLY')).reason, 'INVALID_OR_UNSAFE_TRANSITION');
});
