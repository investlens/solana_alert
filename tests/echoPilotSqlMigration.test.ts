import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from '../src/echo/liveBuyPolicy.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const sig='3'.repeat(64);
const mint=(n:number)=>String(n).repeat(44);
test('atomic SQL migration enforces two open slots, lifetime duplicate lock and UTC daily cap',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  const base=await readFile('docs/sql/echo-live-buy-intents.sql','utf8');
  const pilot=await readFile('docs/sql/echo-pilot-atomic-two-slot.sql','utf8');
  await db.exec(base);
  await db.exec(pilot);
  const reserve=async(m:string,caller=SLINGOOR_WALLET)=>{
   const result=await db.query<{reply:string}>(
    'select public.echo_pilot_reserve_atomic($1,$2,$3,$4,$5) as reply',
    [wallet,m,caller,sig,50000000]
   );
   return result.rows[0]?.reply;
  };
  assert.equal(await reserve(mint(4)),'RESERVED');
  assert.equal(await reserve(mint(5),CHAIRMAN_WALLET),'RESERVED');
  assert.equal(await reserve(mint(4)),'DUPLICATE_TOKEN');
  assert.equal(await reserve(mint(6)),'TWO_SLOTS_FULL');
  // Simulate a fully chain-verified exit for the first token; SQL requires
  // a sell signature and confirmed original purchase before closing.
  await db.query(`update public.echo_live_buy_intents
    set state='confirmed',sell_signature=$1,position_closed_at=now()
    where execution_wallet=$2 and mint=$3`,[sig,wallet,mint(4)]);
  assert.equal(await reserve(mint(6)),'RESERVED');
  assert.equal(await reserve(mint(4)),'DUPLICATE_TOKEN');
  assert.equal(await reserve(mint(7)),'DAILY_LIMIT');
 } finally{await db.close();}
});
