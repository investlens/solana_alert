import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EchoResearch } from '../src/echo/research.js';
const mint='1'.repeat(32);
test('integrated caller research reserves one paper token across callers and restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-research-integration-'));
 try{
  const path=join(dir,'research.json');
  const first=new EchoResearch(path);
  await first.load();
  await first.addBuy({caller:'WHALE · slingoor',mint,signature:'2'.repeat(64),deliveryAt:Date.now()/1000});
  await first.addBuy({caller:'CHAIRMAN',mint,signature:'3'.repeat(64),deliveryAt:Date.now()/1000});
  assert.equal(first.summary().total,1);
  assert.equal(first.summary().uniqueTokensReserved,1);
  const restarted=new EchoResearch(path);
  await restarted.load();
  await restarted.addBuy({caller:'CHAIRMAN',mint,signature:'4'.repeat(64),deliveryAt:Date.now()/1000});
  assert.equal(restarted.summary().total,1);
  assert.equal(restarted.summary().paperUsd,10);
  assert.equal(restarted.summary().uniqueTokensReserved,1);
  assert.equal(restarted.summary().liveTrading,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
