import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoTradeStateJournal} from '../src/echo/tradeStateJournal.js';
import {reconcileEchoTradeFromChain} from '../src/echo/reconcileTradeFromChain.js';
const key='wallet:mint',signature='3'.repeat(64),fingerprint='a'.repeat(64);
const status=(statusValue:unknown):typeof fetch=>(async()=>({
 ok:true,json:async()=>({result:{value:[statusValue]}})
} as Response)) as typeof fetch;
test('restart reconciles exact signature once, without broadcasting or replaying',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'echo-recover-'));
 try{
  const path=join(folder,'journal.json'),journal=new EchoTradeStateJournal(path);
  await journal.load();assert.equal(await journal.reserve(key),true);
  assert.equal((await journal.advance(key,{kind:'QUOTE_OK',nowMs:1000})).ok,true);
  assert.equal((await journal.advance(key,{kind:'SIMULATION_OK',nowMs:1001})).ok,true);
  assert.equal((await journal.advance(key,{kind:'SUBMISSION_RESULT_UNKNOWN',fingerprint,signature})).ok,true);
  const restarted=new EchoTradeStateJournal(path);await restarted.load();
  assert.equal(restarted.get(key)?.state,'SUBMISSION_UNKNOWN');
  assert.deepEqual(await reconcileEchoTradeFromChain(restarted,key,'https://rpc.example.com/',
   status({confirmationStatus:'finalized',err:null})),
   {kind:'CONFIRMED',reason:'CHAIN_SIGNATURE_VERIFIED'});
  assert.equal(restarted.get(key)?.state,'CONFIRMED');
  assert.equal(await restarted.reserve(key),false);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('pending or unknown submissions hold slot and never attempt to broadcast',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'echo-pending-'));
 try{
  const journal=new EchoTradeStateJournal(join(folder,'state.json'));await journal.load();
  assert.equal(await journal.reserve(key),true);
  assert.equal((await journal.advance(key,{kind:'QUOTE_OK',nowMs:1000})).ok,true);
  assert.equal((await journal.advance(key,{kind:'SIMULATION_OK',nowMs:1001})).ok,true);
  assert.equal((await journal.advance(key,{kind:'SUBMISSION_RESULT_UNKNOWN',fingerprint,signature})).ok,true);
  const value=await reconcileEchoTradeFromChain(journal,key,'https://rpc.example.com/',status(null));
  assert.deepEqual(value,{kind:'HOLD',reason:'NOT_FINAL_NO_RETRY'});
  assert.equal(journal.get(key)?.state,'SUBMISSION_UNKNOWN');
 }finally{await rm(folder,{recursive:true,force:true});}
});
