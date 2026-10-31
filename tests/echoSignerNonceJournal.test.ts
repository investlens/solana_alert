import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('signer nonce is durable, one-time and cannot be reused after expiration',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(await readFile('docs/sql/echo-signer-nonce-replay-journal.sql','utf8'));
  const n='a'.repeat(64);
  const consume=async(nonce:string,seconds:number)=>{
   const q=await db.query<{ok:boolean}>(`select public.echo_signer_consume_nonce($1, now() + $2::interval) as ok`,
    [nonce,`${seconds} seconds`]);
   return q.rows[0]?.ok;
  };
  assert.equal(await consume(n,15),true);
  assert.equal(await consume(n,15),false);
  assert.equal(await consume('b'.repeat(64),-2),false);
  assert.equal(await consume('c'.repeat(64),120),false);
  assert.equal(await consume('invalid',10),false);
  const count=await db.query<{n:number}>(`select count(*)::int as n from public.echo_signer_used_nonces`);
  assert.equal(count.rows[0]?.n,1);
 }finally{await db.close();}
});
