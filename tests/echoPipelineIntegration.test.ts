import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EchoQueue } from '../src/echo/queue.js';
import { EchoStore } from '../src/echo/store.js';
import { EchoResearch } from '../src/echo/research.js';
const sig='2'.repeat(64),mint='1'.repeat(32);
test('queued verified BUY produces one admin notification and one durable $10 research position',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-pipeline-'));
 try{
  const store=new EchoStore(join(dir,'delivered.json'));await store.load();
  const research=new EchoResearch(join(dir,'research.json'));await research.load();
  let sent=0;
  const process=async(signature:string)=>{
   if(store.has('tx:'+signature))return;
   sent++; // Stubbed Telegram success; no network or real trades.
   await store.delivered('tx:'+signature,Date.now()/1000);
   await research.addBuy({caller:'WHALE · slingoor',mint,signature,deliveryAt:Date.now()/1000});
  };
  const queue=new EchoQueue(process,Date.now,join(dir,'queue.json'));
  assert.equal(queue.add(sig,true),true);
  await queue.tick();
  assert.equal(sent,1);assert.equal(queue.size,0);assert.equal(research.summary().uniqueTokensReserved,1);
  const restoredStore=new EchoStore(join(dir,'delivered.json'));await restoredStore.load();
  const restoredResearch=new EchoResearch(join(dir,'research.json'));await restoredResearch.load();
  const restartedQueue=new EchoQueue(async signature=>{if(!restoredStore.has('tx:'+signature))throw Error('unexpected redelivery');},Date.now,join(dir,'queue.json'));
  assert.equal(restartedQueue.size,0);
  assert.equal(restoredStore.has('tx:'+sig),true);
  await restoredResearch.addBuy({caller:'CHAIRMAN',mint,signature:'3'.repeat(64),deliveryAt:Date.now()/1000});
  assert.equal(restoredResearch.summary().total,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
