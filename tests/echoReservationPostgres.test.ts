import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const schema = `create table echo_live_buy_intents (
 execution_wallet text not null, mint text not null, caller_wallet text not null,
 source_signature text not null, amount_lamports bigint not null,
 state text not null default 'reserved', primary key(execution_wallet,mint));`;
const row = (caller:string, mint='2'.repeat(32), wallet='1'.repeat(32)) =>
 [wallet,mint,caller,'4'.repeat(64),10000000];
const sql = 'insert into echo_live_buy_intents(execution_wallet,mint,caller_wallet,source_signature,amount_lamports) values ($1,$2,$3,$4,$5)';

test('Postgres unique constraint rejects repeat and cross-caller buys after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-reservation-'));
 try {
  let db=new PGlite(dir);
  await db.exec(schema);
  await db.query(sql,row('3'.repeat(32)));
  await db.close();
  db=new PGlite(dir);
  await assert.rejects(db.query(sql,row('5'.repeat(32))),/duplicate key value violates unique constraint/);
  const result=await db.query<{n:number}>('select count(*)::int as n from echo_live_buy_intents');
  assert.equal(result.rows[0]?.n,1);
  await db.query(sql,row('3'.repeat(32),'6'.repeat(32)));
  await db.query(sql,row('3'.repeat(32),'2'.repeat(32),'7'.repeat(32)));
  const distinct=await db.query<{n:number}>('select count(*)::int as n from echo_live_buy_intents');
  assert.equal(distinct.rows[0]?.n,3);
  await db.close();
 } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('Postgres resolves competing same-token reservations to exactly one winner',async()=>{
 const db=new PGlite();
 try {
  await db.exec(schema);
  const results=await Promise.allSettled([db.query(sql,row('3'.repeat(32))),db.query(sql,row('5'.repeat(32)))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const count=await db.query<{n:number}>('select count(*)::int as n from echo_live_buy_intents');
  assert.equal(count.rows[0]?.n,1);
 } finally { await db.close(); }
});
