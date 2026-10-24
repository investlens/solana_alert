import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EchoResearch } from '../src/echo/research.js';

test('Echo research persists and dedupes buys; samples price, observes existing paper stop', async () => {
  const dir = await mkdtemp(join(tmpdir(),'alphaos-echo-research-'));
  const path = join(dir,'state.json');
  const oldFetch = globalThis.fetch;
  const now = Date.now()/1000;
  const mint='So11111111111111111111111111111111111111112';
  const captured:string[] = [];
  let price=1;
  globalThis.fetch = (async (url: string | URL | Request) => {
    captured.push(String(url));
    return {ok:true,json:async()=>({pairs:[{chainId:'solana',
      baseToken:{address:mint},pairAddress:'POOL_A',priceUsd:String(price),liquidity:{usd:20000}}]})} as Response;
  }) as typeof fetch;
  try {
    const research = new EchoResearch(path);
    await research.load();
    const ev={caller:'fixture',mint,signature:'x'.repeat(80),deliveryAt:now-10};
    await research.addBuy(ev); await research.addBuy(ev);
    await research.tick();
    let stored = JSON.parse(await readFile(path,'utf8'));
    assert.equal(stored.trials.length,1);
    assert.equal(stored.trials[0].entry,1);
    assert.equal(stored.trials[0].pool,'POOL_A');
    assert.equal(stored.trials[0].status,'TRACKING');
    // The 60-second polling guard is intentional; accelerate via isolated clock-only fixture.
    const originalDateNow=Date.now;
    try {
      Date.now = () => originalDateNow()+61_000;
      price=1.6;
      await research.tick();
      stored=JSON.parse(await readFile(path,'utf8'));
      assert.equal(stored.trials[0].stop.stop>1,true);
      assert.equal(stored.trials[0].peak,1.6);
      Date.now = () => originalDateNow()+122_000;
      price=1.2;
      await research.tick();
    } finally {Date.now=originalDateNow;}
    stored=JSON.parse(await readFile(path,'utf8'));
    assert.equal(stored.trials[0].exitPrice,1.2);
    assert.equal(stored.trials[0].status,'EXIT_OBSERVED');
    assert.equal(captured.length,3);
    const restarted=new EchoResearch(path);
    await restarted.load();
    assert.equal(restarted.summary().total,1);
  } finally {
    globalThis.fetch=oldFetch;
    await rm(dir,{recursive:true,force:true});
  }
});

test('invalid mints do not create research positions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alphaos-echo-research-'));
  try {
    const research=new EchoResearch(join(dir,'state.json'));
    await research.load();
    await research.addBuy({caller:'fixture',mint:'INVALID',signature:'x'.repeat(80),deliveryAt:Date.now()/1000});
    assert.equal(research.summary().total,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});
