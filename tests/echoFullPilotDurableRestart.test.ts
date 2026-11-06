import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from '../src/echo/liveBuyPolicy.js';

const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint=(n:number)=>String(n).repeat(44);
const sig=(n:number)=>String(n).repeat(64);

test('full pilot SQL persists fee-inclusive budget, one-shot claim and signer nonces across DB restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'echo-full-pilot-durable-'));
 const disk=join(root,'postgres');
 let db:PGlite|null=null;
 try{
  db=new PGlite(disk);
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const path of [
   'docs/sql/echo-live-buy-intents.sql',
   'docs/sql/echo-pilot-atomic-two-slot.sql',
   'docs/sql/echo-pilot-all-in-atomic.sql',
   'docs/sql/echo-pilot-one-shot-submission.sql',
   'docs/sql/echo-signer-nonce-replay-journal.sql'
  ])await db.exec(await readFile(path,'utf8'));
  const reserve=(d:PGlite,n:number,caller=SLINGOOR_WALLET)=>d.query<{outcome:string}>(`
   select public.echo_pilot_reserve_all_in_atomic(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) as outcome`,
   [wallet,mint(n),caller,sig(3),25_000_000,500,20_000,500,100,3_500]);
  // Simultaneous promises are independent requests on one disposable PGlite
  // instance. This does NOT substitute for two real Postgres connections.
  const attempts=await Promise.all([
   reserve(db,4),reserve(db,5,CHAIRMAN_WALLET),reserve(db,6),reserve(db,7)
  ]);
  assert.equal(attempts.filter(x=>x.rows[0]?.outcome==='RESERVED').length,2);
  assert.equal(attempts.filter(x=>x.rows[0]?.outcome==='TWO_SLOTS_FULL').length,2);
  const rows=await db.query<{mint:string}>(
   'select mint from public.echo_live_buy_intents order by mint');
  const [first,second]=rows.rows.map(x=>x.mint);
  assert.ok(first&&second);
  const consume=(d:PGlite)=>d.query<{accepted:boolean}>(`
    select public.echo_signer_consume_nonce($1,now()+interval '20 seconds') accepted`,
    ['a'.repeat(64)]);
  assert.equal((await consume(db)).rows[0]?.accepted,true);
  assert.equal((await consume(db)).rows[0]?.accepted,false);
  const claim=(d:PGlite,signature=sig(8))=>d.query<{outcome:string}>(`
    select public.echo_pilot_claim_submission_once($1,$2,$3,$4,$5,$6) outcome`,
    [wallet,first,signature,'b'.repeat(64),'c'.repeat(64),1_000_000]);
  const competing=await Promise.all([claim(db),claim(db,sig(9))]);
  assert.deepEqual(competing.map(x=>x.rows[0]?.outcome).sort(),
   ['ALREADY_CLAIMED_OR_NOT_RESERVED','CLAIMED']);
  await db.close();db=null;

  db=new PGlite(disk);
  const persisted=await db.query<{state:string;submission_claimed_at:string;
   transaction_signature:string}>(`
   select state,submission_claimed_at,transaction_signature
   from public.echo_live_buy_intents where execution_wallet=$1 and mint=$2`,
   [wallet,first]);
  assert.equal(persisted.rows[0]?.state,'unknown');
  assert.ok(persisted.rows[0]?.submission_claimed_at);
  assert.ok([sig(8),sig(9)].includes(persisted.rows[0]?.transaction_signature));
  assert.equal((await consume(db)).rows[0]?.accepted,false);
  assert.equal((await claim(db)).rows[0]?.outcome,'ALREADY_CLAIMED_OR_NOT_RESERVED');
  assert.equal((await db.query<{outcome:string}>(`
   select public.echo_pilot_reserve_all_in_atomic(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) outcome`,
   [wallet,first,SLINGOOR_WALLET,sig(3),25_000_000,500,20_000,500,100,3_500]))
   .rows[0]?.outcome,'DUPLICATE_TOKEN');
  assert.equal((await reserve(db,8)).rows[0]?.outcome,'TWO_SLOTS_FULL');
  const committed=await db.query<{committed_cents:string}>(`
   select committed_cents::text from public.echo_pilot_capital_ledger
   where execution_wallet=$1`,[wallet]);
  assert.equal(committed.rows[0]?.committed_cents,'2000');
 }finally{
  if(db)await db.close();
  rmSync(root,{recursive:true,force:true});
 }
});
