import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoTradeStateJournal} from '../src/echo/tradeStateJournal.js';
const fingerprint='a'.repeat(64);
test('durable trade intent survives restart and forbids blind retry after unknown submission',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-trade-journal-')),path=join(dir,'state.json');
 try{
  let j=new EchoTradeStateJournal(path);await j.load();
  const key='wallet:mint';
  const [a,b]=await Promise.all([j.reserve(key),j.reserve(key)]);
  assert.equal([a,b].filter(Boolean).length,1);
  assert.equal((await j.advance(key,{kind:'QUOTE_OK',nowMs:10000})).ok,true);
  assert.equal((await j.advance(key,{kind:'SIMULATION_OK',nowMs:10001})).ok,true);
  assert.equal((await j.advance(key,{kind:'SUBMISSION_RESULT_UNKNOWN',fingerprint})).ok,true);
  j=new EchoTradeStateJournal(path);await j.load();
  assert.equal(j.get(key)?.state,'SUBMISSION_UNKNOWN');
  assert.equal(await j.reserve(key),false);
  assert.equal((await j.advance(key,{kind:'QUOTE_OK',nowMs:10003})).ok,false);
  assert.equal((await j.advance(key,{kind:'SUBMISSION_RESULT_UNKNOWN',fingerprint})).ok,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('corrupt persisted state fails closed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-corrupt-journal-')),path=join(dir,'state.json');
 try{
  const {writeFileSync}=await import('node:fs');
  writeFileSync(path,'{"version":1,"records":[{"reservationKey":"a","state":"INVALID"}]}');
  const j=new EchoTradeStateJournal(path);
  await assert.rejects(j.load(),/CORRUPT_TRADE_JOURNAL/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
