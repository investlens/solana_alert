import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEchoSupabaseReservationStore } from '../src/echo/supabaseReservation.js';
function mockClient(error: null | {code:string}) {
  const inserts: unknown[]=[];
  const client={from(table:string){assert.equal(table,'echo_live_buy_intents');return {async insert(row:unknown){inserts.push(row);return {error};}}}} as unknown as SupabaseClient;
  return {client,inserts};
}
const row={executionWallet:'1'.repeat(32),mint:'2'.repeat(32),callerWallet:'3'.repeat(32),sourceSignature:'4'.repeat(64),amountLamports:100000000};
test('atomic insert includes execution wallet and mint uniqueness fields',async()=>{
  const {client,inserts}=mockClient(null);
  assert.equal(await createEchoSupabaseReservationStore(client).insertOnce(row),true);
  assert.deepEqual(inserts,[{execution_wallet:row.executionWallet,mint:row.mint,caller_wallet:row.callerWallet,source_signature:row.sourceSignature,amount_lamports:row.amountLamports,state:'reserved'}]);
});
test('unique conflict rejects duplicate without releasing reservation',async()=>{
  const {client}=mockClient({code:'23505'});
  assert.equal(await createEchoSupabaseReservationStore(client).insertOnce(row),false);
});
test('database errors fail closed rather than being mistaken for duplicates',async()=>{
  const {client}=mockClient({code:'42501'});
  await assert.rejects(createEchoSupabaseReservationStore(client).insertOnce(row),/ECHO_RESERVATION_STORAGE_ERROR/);
});
