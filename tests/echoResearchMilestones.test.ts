import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoResearch} from '../src/echo/research.js';
test('mark-price 2x milestone remains recorded even after a paper stop exit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'echo-milestones-'));const path=join(dir,'research.json');
 const fetchOriginal=globalThis.fetch,dateNowOriginal=Date.now;
 const mint='So11111111111111111111111111111111111111112';let price=1;
 globalThis.fetch=(async()=>({ok:true,json:async()=>({pairs:[{chainId:'solana',baseToken:{address:mint},pairAddress:'pool-1',priceUsd:String(price),liquidity:{usd:30000}}]})})) as unknown as typeof fetch;
 const t=dateNowOriginal();
 try{
   const engine=new EchoResearch(path);await engine.load();
   await engine.addBuy({caller:'SOLANA_BOOST',mint,signature:'BOOST:safe-test',deliveryAt:t/1000-5});
   await engine.tick();
   Date.now=()=>t+61000;price=0.75;await engine.tick();
   Date.now=()=>t+122000;price=2.1;await engine.tick();
   const state=JSON.parse(await readFile(path,'utf8')).trials[0];
   assert.equal(state.status,'EXIT_OBSERVED');
   assert.equal(typeof state.milestones['2'],'number');
   assert.equal(state.milestones['5'],undefined);
 } finally{Date.now=dateNowOriginal;globalThis.fetch=fetchOriginal;await rm(dir,{recursive:true,force:true});}
});