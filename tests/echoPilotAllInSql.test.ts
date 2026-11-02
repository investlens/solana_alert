import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from '../src/echo/liveBuyPolicy.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const source='3'.repeat(64);
const mint=(n:number)=>String(n).repeat(44);
test('database atomically enforces fee-inclusive $30 lifetime cap and exit reserve',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const file of ['docs/sql/echo-live-buy-intents.sql',
    'docs/sql/echo-pilot-atomic-two-slot.sql','docs/sql/echo-pilot-all-in-atomic.sql'])
   await db.exec(await readFile(file,'utf8'));
  const reserve=async(m:string,opts:{principal?:number;fee?:number;balance?:number;
    exit?:number;caller?:string;when?:string}={})=>{
   const reply=await db.query<{result:string}>(`select public.echo_pilot_reserve_all_in_atomic(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz) as result`,
     [wallet,m,opts.caller??SLINGOOR_WALLET,source,25000000,
      opts.principal??500,20000,opts.fee??500,opts.exit??100,
      opts.balance??3500,opts.when??new Date().toISOString()]);
   return reply.rows[0]?.result;
  };
  assert.equal(await reserve(mint(4),{principal:550,fee:500}),'PRINCIPAL_FX_MISMATCH');
  assert.equal(await reserve(mint(4),{fee:501}),'ALL_IN_ENTRY_CAP');
  assert.equal(await reserve(mint(4),{balance:1000}),'BALANCE_AND_EXIT_RESERVE');
  assert.equal(await reserve(mint(4)),'RESERVED');
  const principal=await db.query<{principal:string;reserved:string}>(`select
   principal_usd::text principal,pilot_all_in_reserved_cents::text reserved
   from public.echo_live_buy_intents where execution_wallet=$1 and mint=$2`,
   [wallet,mint(4)]);
  assert.equal(principal.rows[0]?.principal,'5.00');
  assert.equal(principal.rows[0]?.reserved,'1000');
  const wrongSize=await db.query<{result:string}>(`select
   public.echo_pilot_reserve_all_in_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) result`,
   [wallet,mint(9),SLINGOOR_WALLET,source,50000000,1000,20000,1,100,3500]);
  assert.equal(wrongSize.rows[0]?.result,'INVALID_OR_STALE_ATTESTATION');
  assert.equal(await reserve(mint(4)),'DUPLICATE_TOKEN');
  assert.equal(await reserve(mint(5),{caller:CHAIRMAN_WALLET}),'RESERVED');
  assert.equal(await reserve(mint(6)),'TWO_SLOTS_FULL');
  // A confirmed and independently verified full exit can free a POSITION,
  // not undo the lifetime pilot committed capital.
  await db.query(`update public.echo_live_buy_intents
    set state='confirmed',sell_signature=$1,position_closed_at=now()
    where execution_wallet=$2 and mint=$3`,[source,wallet,mint(4)]);
  assert.equal(await reserve(mint(6)),'RESERVED');
  await db.query(`update public.echo_live_buy_intents
    set state='confirmed',sell_signature=$1,position_closed_at=now()
    where execution_wallet=$2 and mint=$3`,[source,wallet,mint(5)]);
  assert.equal(await reserve(mint(7)),'PILOT_LIFETIME_CAP');
  const state=await db.query<{committed_cents:string}>(`select committed_cents::text
   from public.echo_pilot_capital_ledger where execution_wallet=$1`,[wallet]);
  assert.equal(state.rows[0]?.committed_cents,'3000');
  assert.equal(await reserve(mint(8),{when:'2020-01-01T00:00:00Z'}),
    'INVALID_OR_STALE_ATTESTATION');
 }finally{await db.close();}
});
test('simultaneous reservations cannot exceed two slots or $30 even with racing clients',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const file of ['docs/sql/echo-live-buy-intents.sql',
    'docs/sql/echo-pilot-atomic-two-slot.sql','docs/sql/echo-pilot-all-in-atomic.sql'])
   await db.exec(await readFile(file,'utf8'));
  const run=(n:number)=>db.query<{reply:string}>(`select public.echo_pilot_reserve_all_in_atomic(
    $1,$2,$3,$4,$5, $6,$7,$8,$9,$10,now()) as reply`,
    [wallet,mint(n),SLINGOOR_WALLET,source,25000000,500,20000,500,100,3500]);
  const results=await Promise.all([run(4),run(5),run(6),run(7)]);
  assert.equal(results.filter(x=>x.rows[0]?.reply==='RESERVED').length,2);
  const counts=await db.query<{n:number}>(`select count(*)::int n
    from public.echo_live_buy_intents`);
  assert.equal(counts.rows[0]?.n,2);
 }finally{await db.close();}
});
