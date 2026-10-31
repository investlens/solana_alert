import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createEchoSupabaseNonceStore} from '../src/echo/supabaseNonceStore.js';
function fake(data:unknown,error:unknown=null){
 const calls:Array<Record<string,unknown>>=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  assert.equal(name,'echo_signer_consume_nonce');
  calls.push(args);
  return {data,error};
 }} as unknown as SupabaseClient;
 return {client,calls};
}
test('signer nonce uses DB atomic RPC and accepts only explicit true',async()=>{
 const n='a'.repeat(64),expires=Date.now()+15_000;
 const yes=fake(true);
 assert.equal(await createEchoSupabaseNonceStore(yes.client).consumeOnce(n,expires),true);
 assert.equal(yes.calls.length,1);
 assert.equal(yes.calls[0].p_nonce_hex,n);
 const replay=fake(false);
 assert.equal(await createEchoSupabaseNonceStore(replay.client).consumeOnce(n,expires),false);
 const denied=fake('true');
 assert.equal(await createEchoSupabaseNonceStore(denied.client).consumeOnce(n,expires),false);
 const offline=fake(true,{message:'unavailable'});
 assert.equal(await createEchoSupabaseNonceStore(offline.client).consumeOnce(n,expires),false);
});
test('invalid, expired and overlong nonce windows never touch the DB',async()=>{
 const f=fake(true);const store=createEchoSupabaseNonceStore(f.client);
 assert.equal(await store.consumeOnce('not-valid',Date.now()+1000),false);
 assert.equal(await store.consumeOnce('b'.repeat(64),Date.now()-1000),false);
 assert.equal(await store.consumeOnce('b'.repeat(64),Date.now()+120000),false);
 assert.equal(f.calls.length,0);
});
