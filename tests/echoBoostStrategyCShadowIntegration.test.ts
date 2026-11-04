import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoResearch} from '../src/echo/research.js';

const mint='So11111111111111111111111111111111111111112';
const fakePrice=(p:number)=>({ok:true,json:async()=>({pairs:[{
 chainId:'solana',baseToken:{address:mint},pairAddress:'fixed-pool',
 priceUsd:String(p),liquidity:{usd:25000}
}]})});

test('opt-in Strategy C reuses research samples, persists activation, excludes historical trades',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'echo-c-shadow-'));
 const file=join(dir,'research.json'),fetch0=globalThis.fetch,now0=Date.now;
 const started=1800000000000;let price=1;
 globalThis.fetch=(async()=>fakePrice(price)) as unknown as typeof fetch;
 try{
  Date.now=()=>started;
  const before=new EchoResearch(file);await before.load();
  await before.addBuy({caller:'SOLANA_BOOST',mint:'1'.repeat(32),
   signature:'historical',deliveryAt:started/1000-30});
  const engine=new EchoResearch(file,undefined,{boostStrategyCShadowEnabled:true});
  await engine.load();
  const first=engine.summary().strategyCShadow;
  assert.ok(first);
  assert.equal(first.prospects,0);
  assert.equal(first.liveTrading,false);
  assert.equal(first.executableVerified,false);
  assert.equal(first.forwardOnlySince,started/1000);
  await engine.addBuy({caller:'SOLANA_BOOST',mint,signature:'boost',
   deliveryAt:started/1000+0.2});
  Date.now=()=>started+1000;await engine.tick(true);
  price=1.6;Date.now=()=>started+62000;await engine.tick(true);
  let partial=engine.summary().strategyCShadow;
  assert.ok(partial);
  assert.equal(partial.prospects,1);
  assert.equal(partial.partialSales,1);
  assert.equal(partial.cClosed,0);
  assert.equal(partial.cOpen,1);
  price=1.1;Date.now=()=>started+123000;await engine.tick(true);
  const done=engine.summary().strategyCShadow;
  assert.ok(done);
  assert.equal(done.cClosed,1);
  assert.equal(done.partialSales,1);
  // The existing full-position trailing stop also exits at 1.1; both
  // strategies are now comparable on this same closed paper position.
  assert.equal(done.pairedClosed,1);
  assert.ok(done.pairedExistingPnlUsd>0);
  assert.ok(done.pairedStrategyCPnlUsd>0);
  assert.ok(done.cClosedPnlUsd>0);
  const prior=JSON.parse(await readFile(file,'utf8'));
  assert.equal(prior.strategyCShadowSince,started/1000);
  const restarted=new EchoResearch(file,undefined,{boostStrategyCShadowEnabled:true});
  Date.now=()=>started+125000;await restarted.load();
  assert.equal(restarted.summary().strategyCShadow?.cClosed,1);
  assert.equal(restarted.summary().strategyCShadow?.forwardOnlySince,started/1000);
  const disabled=new EchoResearch(file);await disabled.load();
  assert.equal(disabled.summary().strategyCShadow,null);
  assert.equal(disabled.summary().liveTrading,false);
 }finally{
  Date.now=now0;globalThis.fetch=fetch0;await rm(dir,{recursive:true,force:true});
 }
});

test('disabled Strategy C never modifies legacy research result',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'echo-c-disabled-'));
 try{
  const paper=new EchoResearch(join(dir,'research.json'));
  await paper.load();
  assert.equal(paper.summary().strategyCShadow,null);
  assert.equal(paper.summary().liveTrading,false);
  assert.equal(paper.summary().paperUsd,10);
 }finally{await rm(dir,{recursive:true,force:true});}
});
