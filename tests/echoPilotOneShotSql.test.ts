import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='2'.repeat(44),sig='3'.repeat(64),sha='a'.repeat(64),fingerprint='b'.repeat(64);
async function setup(){
 const db=new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role;');
 for(const path of [
  'docs/sql/echo-live-buy-intents.sql',
  'docs/sql/echo-pilot-atomic-two-slot.sql',
  'docs/sql/echo-pilot-all-in-atomic.sql',
  'docs/sql/echo-pilot-one-shot-submission.sql'
 ])await db.exec(await readFile(path,'utf8'));
 const reserved=await db.query<{result:string}>(`select public.echo_pilot_reserve_all_in_atomic(
 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) result`,
 [wallet,mint,SLINGOOR_WALLET,sig,25000000,500,20000,500,100,3500]);
 assert.equal(reserved.rows[0].result,'RESERVED');
 return db;
}
function claim(db:PGlite,overrides:any[]=[]){
 return db.query<{result:string}>(`select public.echo_pilot_claim_submission_once(
 $1,$2,$3,$4,$5,$6) result`,
 overrides.length?overrides:[wallet,mint,sig,sha,fingerprint,10000]);
}
test('one atomic claim stores original signature and UNKNOWN state before any broadcast',async()=>{
 const db=await setup();
 try{
  const result=await claim(db);
  assert.equal(result.rows[0]?.result,'CLAIMED');
  const row=await db.query<{state:string;transaction_signature:string;
   approved_message_sha256:string;signed_transaction_fingerprint_sha256:string;
   submission_claimed_at:string}>(`select state,transaction_signature,
 approved_message_sha256,signed_transaction_fingerprint_sha256,submission_claimed_at
 from public.echo_live_buy_intents where execution_wallet=$1 and mint=$2`,
 [wallet,mint]);
  assert.equal(row.rows[0].state,'unknown');
  assert.equal(row.rows[0].transaction_signature,sig);
  assert.equal(row.rows[0].approved_message_sha256,sha);
  assert.equal(row.rows[0].signed_transaction_fingerprint_sha256,fingerprint);
  assert.ok(row.rows[0].submission_claimed_at);
  assert.equal((await claim(db)).rows[0]?.result,'ALREADY_CLAIMED_OR_NOT_RESERVED');
  assert.equal((await claim(db,[wallet,mint,'4'.repeat(64),sha,fingerprint,10000]))
   .rows[0]?.result,'ALREADY_CLAIMED_OR_NOT_RESERVED');
 }finally{await db.close();}
});
test('invalid claims, missing reservation and missing all-in budget fail closed',async()=>{
 const db=await setup();
 try{
  assert.equal((await claim(db,[wallet,mint,'bad',sha,fingerprint,10000]))
   .rows[0]?.result,'INVALID_CLAIM');
  assert.equal((await claim(db,[wallet,'5'.repeat(44),sig,sha,fingerprint,10000]))
   .rows[0]?.result,'NO_RESERVATION');
  await db.query(`update public.echo_live_buy_intents
    set pilot_all_in_reserved_cents=null where execution_wallet=$1 and mint=$2`,
    [wallet,mint]);
  assert.equal((await claim(db)).rows[0]?.result,'ALL_IN_CAPITAL_NOT_RESERVED');
  const state=await db.query<{state:string;signature:string|null}>(`select state,
    transaction_signature as signature from public.echo_live_buy_intents
    where execution_wallet=$1 and mint=$2`,[wallet,mint]);
  assert.equal(state.rows[0].state,'reserved');
  assert.equal(state.rows[0].signature,null);
 }finally{await db.close();}
});
test('concurrent claims elect one winner even after service restart',async()=>{
 const db=await setup();
 try{
  const [a,b]=await Promise.all([
   claim(db),claim(db,[wallet,mint,'4'.repeat(64),sha,fingerprint,10000])
  ]);
  assert.deepEqual([a.rows[0].result,b.rows[0].result].sort(),
   ['ALREADY_CLAIMED_OR_NOT_RESERVED','CLAIMED']);
  const rows=await db.query<{n:number}>(`select count(*)::int n
 from public.echo_live_buy_intents where state='unknown'`);
  assert.equal(rows.rows[0].n,1);
 }finally{await db.close();}
});

test('a Solana signature cannot be associated with two token claims',async()=>{
 const db=await setup();
 const secondMint='5'.repeat(44);
 try{
  const reserve=await db.query<{result:string}>(`select public.echo_pilot_reserve_all_in_atomic(
   $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) result`,
   [wallet,secondMint,SLINGOOR_WALLET,'4'.repeat(64),25000000,500,20000,500,100,3500]);
  assert.equal(reserve.rows[0].result,'RESERVED');
  assert.equal((await claim(db)).rows[0].result,'CLAIMED');
  await assert.rejects(
   claim(db,[wallet,secondMint,sig,sha,fingerprint,10000]),
   /duplicate key value violates unique constraint/
  );
  const second=await db.query<{state:string;transaction_signature:string|null}>(
   `select state,transaction_signature from public.echo_live_buy_intents
    where execution_wallet=$1 and mint=$2`,[wallet,secondMint]);
  assert.equal(second.rows[0].state,'reserved');
  assert.equal(second.rows[0].transaction_signature,null);
 }finally{await db.close();}
});

test('fee-inclusive reservation and one-shot RPCs are service-only; legacy bypass is retired',async()=>{
 const db=await setup();
 try{
  const r=await db.query<{
   rowRls:boolean;ledgerRls:boolean;
   anonReserve:boolean;authenticatedReserve:boolean;serviceReserve:boolean;
   anonClaim:boolean;authenticatedClaim:boolean;serviceClaim:boolean;
   legacyService:boolean;anonLedgerInsert:boolean;serviceLedgerInsert:boolean
  }>(`select
   (select relrowsecurity from pg_class where oid='public.echo_live_buy_intents'::regclass) as "rowRls",
   (select relrowsecurity from pg_class where oid='public.echo_pilot_capital_ledger'::regclass) as "ledgerRls",
   has_function_privilege('anon','public.echo_pilot_reserve_all_in_atomic(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE') as "anonReserve",
   has_function_privilege('authenticated','public.echo_pilot_reserve_all_in_atomic(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE') as "authenticatedReserve",
   has_function_privilege('service_role','public.echo_pilot_reserve_all_in_atomic(text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz)','EXECUTE') as "serviceReserve",
   has_function_privilege('anon','public.echo_pilot_claim_submission_once(text,text,text,text,text,bigint)','EXECUTE') as "anonClaim",
   has_function_privilege('authenticated','public.echo_pilot_claim_submission_once(text,text,text,text,text,bigint)','EXECUTE') as "authenticatedClaim",
   has_function_privilege('service_role','public.echo_pilot_claim_submission_once(text,text,text,text,text,bigint)','EXECUTE') as "serviceClaim",
   has_function_privilege('service_role','public.echo_pilot_reserve_atomic(text,text,text,text,bigint)','EXECUTE') as "legacyService",
   has_table_privilege('anon','public.echo_pilot_capital_ledger','INSERT') as "anonLedgerInsert",
   has_table_privilege('service_role','public.echo_pilot_capital_ledger','INSERT') as "serviceLedgerInsert"`);
  assert.deepEqual(r.rows[0],{
   rowRls:true,ledgerRls:true,
   anonReserve:false,authenticatedReserve:false,serviceReserve:true,
   anonClaim:false,authenticatedClaim:false,serviceClaim:true,
   legacyService:false,anonLedgerInsert:false,serviceLedgerInsert:true
  });
 }finally{await db.close();}
});
