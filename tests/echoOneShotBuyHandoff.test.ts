import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoTradeStateJournal} from '../src/echo/tradeStateJournal.js';
import {persistEchoOneShotUnknown,prepareEchoOneShotBuyHandoff,
 ECHO_ONE_SHOT_HANDOFF_BROADCAST_ENABLED} from '../src/echo/oneShotBuyHandoff.js';
const sig='3'.repeat(64),hash='a'.repeat(64);
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'echo-one-shot-'));
 const path=join(dir,'journal.json'),journal=new EchoTradeStateJournal(path);
 await journal.load();const key=wallet+':'+('2'.repeat(44));
 assert.equal(await journal.reserve(key),true);
 assert.equal((await journal.advance(key,{kind:'QUOTE_OK',nowMs:1000})).ok,true);
 assert.equal((await journal.advance(key,{kind:'SIMULATION_OK',nowMs:1001})).ok,true);
 return {dir,path,journal,key};
}
test('one-shot persists original signature BEFORE external send and survives restart',async()=>{
 const f=await setup();
 try{
  const result=await persistEchoOneShotUnknown(f.journal,f.key,sig,hash);
  assert.deepEqual(result,{ok:true,mode:'PERSISTED_NO_BROADCAST',
   signature:sig,fingerprint:hash,broadcastAllowed:false});
  assert.equal(ECHO_ONE_SHOT_HANDOFF_BROADCAST_ENABLED,false);
  const restarted=new EchoTradeStateJournal(f.path);await restarted.load();
  assert.equal(restarted.get(f.key)?.signature,sig);
  assert.equal(restarted.get(f.key)?.state,'SUBMISSION_UNKNOWN');
  const again=await persistEchoOneShotUnknown(restarted,f.key,'4'.repeat(64),'b'.repeat(64));
  assert.equal(again.ok,false);
  assert.equal(restarted.get(f.key)?.signature,sig);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('parallel duplicate preparations can commit only one durable submission intent',async()=>{
 const f=await setup();
 try{
  const results=await Promise.all([
   persistEchoOneShotUnknown(f.journal,f.key,sig,hash),
   persistEchoOneShotUnknown(f.journal,f.key,'4'.repeat(64),'b'.repeat(64))
  ]);
  assert.equal(results.filter(x=>x.ok).length,1);
  assert.equal(f.journal.get(f.key)?.state,'SUBMISSION_UNKNOWN');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('unverified wallet and missing trusted DB reservation block before signed handling',async()=>{
 const f=await setup();
 try{
  const denied=await prepareEchoOneShotBuyHandoff({
   journal:f.journal,reservationKey:f.key,signedTransactionBase64:'no-signature',
   approvedMessageSha256:hash,executionWallet:wallet,expectedMint:'2'.repeat(44),
   reservationReader:{getByWalletAndMint:async()=>null}
  });
  assert.deepEqual(denied,{ok:false,reason:'TRUSTED_RESERVATION_NOT_ACTIVE',
   broadcastAllowed:false});
  assert.equal(f.journal.get(f.key)?.state,'SIMULATED');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('DB outage prevents signed handoff without mutating a persisted intent',async()=>{
 const f=await setup();
 try{
  const r=await prepareEchoOneShotBuyHandoff({
   journal:f.journal,reservationKey:f.key,signedTransactionBase64:'invalid',
   approvedMessageSha256:hash,executionWallet:wallet,expectedMint:'2'.repeat(44),
   reservationReader:{getByWalletAndMint:async()=>{throw Error('offline');}}
  });
  assert.deepEqual(r,{ok:false,reason:'TRUSTED_RESERVATION_DB_UNAVAILABLE',broadcastAllowed:false});
  assert.equal(f.journal.get(f.key)?.state,'SIMULATED');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
