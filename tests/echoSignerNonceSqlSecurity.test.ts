import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('signer nonce SQL enforces RLS, service-only insert, and one-use lifetime',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(await readFile('docs/sql/echo-signer-nonce-replay-journal.sql','utf8'));
  const r=await db.query<{relrowsecurity:boolean}>(`select relrowsecurity
    from pg_class where oid='public.echo_signer_used_nonces'::regclass`);
  assert.equal(r.rows[0]?.relrowsecurity,true);
  const acl=await db.query<{insert_ok:boolean;anon_ok:boolean;auth_ok:boolean}>(`select
   has_table_privilege('service_role','public.echo_signer_used_nonces','INSERT') insert_ok,
   has_table_privilege('anon','public.echo_signer_used_nonces','INSERT') anon_ok,
   has_table_privilege('authenticated','public.echo_signer_used_nonces','INSERT') auth_ok`);
  assert.deepEqual(acl.rows[0],{insert_ok:true,anon_ok:false,auth_ok:false});
  const nonce='a'.repeat(64);
  const consume=async()=>db.query<{v:boolean}>(`select
    public.echo_signer_consume_nonce($1,now()+interval '20 seconds') v`,[nonce]);
  assert.equal((await consume()).rows[0]?.v,true);
  assert.equal((await consume()).rows[0]?.v,false);
  assert.equal((await db.query<{v:boolean}>(`select
    public.echo_signer_consume_nonce($1,now()+interval '40 seconds') v`,
    ['b'.repeat(64)])).rows[0]?.v,false);
 }finally{await db.close();}
});
