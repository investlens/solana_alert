import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reserveEchoPaperIntent } from '../src/echo/paperReservation.js';
import { createEchoSupabaseReservationStore } from '../src/echo/supabaseReservation.js';
import type { SecureEchoBuy } from '../src/echo/secureBuyGuard.js';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET,LIVE_EXECUTION_ENABLED} from '../src/echo/liveBuyPolicy.js';
const mint='BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump',executionWallet='11111111111111111111111111111111';
const sig='3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1';
const base:SecureEchoBuy={
 event:{callerWallet:SLINGOOR_WALLET,mint,amountSol:0.05,side:'BUY',isVerifiedSwap:true,transactionSignature:sig},
 ownerWallet:executionWallet,nowMs:10_000,observedAtMs:9_000,spentTodayLamports:0,
 walletBalanceLamports:200_000_000,reserveLamports:10_000_000,killSwitchEngaged:false,
 simulationPassed:true,quoteValid:true,mintAuthorityDisabled:true,freezeAuthorityDisabled:true,
 liquidityVerified:true,sellRouteVerified:true,slippageBps:100,
 landing:{computeUnitLimit:300_000,microLamportsPerCu:100_000}
};
test('SQL-backed Echo reservation: cross-caller concurrency yields one win, restart barrier persists',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create table echo_live_buy_intents(execution_wallet text not null,mint text not null,caller_wallet text not null,source_signature text not null,amount_lamports bigint not null,state text not null,primary key(execution_wallet,mint))');
  const client={from(table:string){assert.equal(table,'echo_live_buy_intents');return {
   async insert(row:Record<string,unknown>){
    try{await db.query('insert into echo_live_buy_intents(execution_wallet,mint,caller_wallet,source_signature,amount_lamports,state) values($1,$2,$3,$4,$5,$6)',Object.values(row));return {error:null};}
    catch(e){return {error:{code:String(e).includes('duplicate key')?'23505':'UNKNOWN'}};}
   }
  }}} as unknown as SupabaseClient;
  const store=createEchoSupabaseReservationStore(client);
  const [a,b]=await Promise.all([
   reserveEchoPaperIntent(base,store),
   reserveEchoPaperIntent({...base,event:{...base.event,callerWallet:CHAIRMAN_WALLET}},store)
  ]);
  assert.equal([a,b].filter(v=>v.reserved).length,1);
  assert.equal([a,b].filter(v=>!v.reserved && v.reason==='DUPLICATE_TOKEN').length,1);
  assert.equal((await db.query<{n:number}>('select count(*)::int n from echo_live_buy_intents')).rows[0].n,1);
  assert.deepEqual(await reserveEchoPaperIntent(base,createEchoSupabaseReservationStore(client)),{reserved:false,reason:'DUPLICATE_TOKEN'});
  assert.equal(LIVE_EXECUTION_ENABLED,false);
 }finally{await db.close();}
});
test('paper reservation fails closed on RPC simulation or storage failure',async()=>{
 let invoked=false;
 const store={insertOnce:async()=>{invoked=true;return true;}};
 const denied=await reserveEchoPaperIntent({...base,simulationPassed:false},store);
 assert.equal(denied.reserved,false);assert.equal(invoked,false);
 const unavailable=await reserveEchoPaperIntent(base,{insertOnce:async()=>{throw Error('DB offline');}});
 assert.deepEqual(unavailable,{reserved:false,reason:'STORAGE_UNAVAILABLE'});
});
