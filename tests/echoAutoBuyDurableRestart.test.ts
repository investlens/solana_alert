import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from '../src/echo/liveBuyPolicy.js';
import {nextEchoTradeState} from '../src/echo/manualTradeLifecycle.js';

const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint=(n:number)=>String(n).repeat(44),sig='3'.repeat(64);
test('auto-BUY one-mint SQL barrier and unknown state survive a real on-disk database restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'echo-autobuy-durable-'));
 const dataDir=join(root,'pgdata');
 let db:PGlite|null=null;
 try{
   db=new PGlite(dataDir);
   await db.exec('create role anon; create role authenticated; create role service_role;');
   await db.exec(await readFile('docs/sql/echo-live-buy-intents.sql','utf8'));
   await db.exec(await readFile('docs/sql/echo-pilot-atomic-two-slot.sql','utf8'));
   const query=async(d:PGlite,m:string,caller=SLINGOOR_WALLET)=>{
     const r=await d.query<{reply:string}>(
       'select public.echo_pilot_reserve_atomic($1,$2,$3,$4,$5) as reply',
       [wallet,m,caller,sig,100_000_000]);
     return r.rows[0]?.reply;
   };
   const race=await Promise.all([
     query(db,mint(4),SLINGOOR_WALLET),
     query(db,mint(4),CHAIRMAN_WALLET)
   ]);
   assert.deepEqual(race.sort(),['DUPLICATE_TOKEN','RESERVED']);
   // A broadcast with unknown outcome MUST retain its slot and mint lock.
   await db.query('update public.echo_live_buy_intents set state=$1 where execution_wallet=$2 and mint=$3',
      ['unknown',wallet,mint(4)]);
   await db.close();db=null;

   // New Postgres process / new DB instance reading the exact same disk path.
   db=new PGlite(dataDir);
   const row=await db.query<{state:string}>(
     'select state from public.echo_live_buy_intents where execution_wallet=$1 and mint=$2',
     [wallet,mint(4)]);
   assert.equal(row.rows[0]?.state,'unknown');
   assert.equal(await query(db,mint(4),CHAIRMAN_WALLET),'DUPLICATE_TOKEN');
   assert.equal(await query(db,mint(5),CHAIRMAN_WALLET),'RESERVED');
   assert.equal(await query(db,mint(6),SLINGOOR_WALLET),'TWO_SLOTS_FULL');

   const blocked=nextEchoTradeState({
     reservationKey:wallet+':'+mint(4),state:'SUBMISSION_UNKNOWN',transactionFingerprint:'a'.repeat(64)
   },{kind:'QUOTE_OK',nowMs:1800000000100});
   assert.deepEqual(blocked,{ok:false,reason:'RECONCILE_OR_HALT_NO_RETRY'});
 }finally{
   if(db)await db.close();
   rmSync(root,{recursive:true,force:true});
 }
});
