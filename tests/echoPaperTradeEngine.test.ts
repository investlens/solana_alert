import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EchoPaperTradeEngine } from '../src/echo/paperTradeEngine.js';
import { SLINGOOR_WALLET, CHAIRMAN_WALLET } from '../src/echo/liveBuyPolicy.js';
import type { SecureEchoBuy } from '../src/echo/secureBuyGuard.js';
const input:SecureEchoBuy={event:{callerWallet:SLINGOOR_WALLET,mint:'1'.repeat(32),amountSol:0.1,side:'BUY',isVerifiedSwap:true,transactionSignature:'1'.repeat(64)},ownerWallet:'1'.repeat(32),nowMs:10000,observedAtMs:9000,spentTodayLamports:0,walletBalanceLamports:200000000,reserveLamports:10000000,killSwitchEngaged:false,simulationPassed:true,quoteValid:true,mintAuthorityDisabled:true,freezeAuthorityDisabled:true,liquidityVerified:true,sellRouteVerified:true,slippageBps:100,landing:{computeUnitLimit:300000,microLamportsPerCu:100000}};
test('paper-only flow records $10 entry, cross-caller dedupe and manual close P&L',async()=>{
 const engine=new EchoPaperTradeEngine();
 const first=await engine.observe(input,0.002);
 assert.equal(first.accepted,true);
 assert.equal(engine.records[0].stakeUsd,10);
 assert.equal(engine.records[0].quantity,5000);
 assert.deepEqual(await engine.observe({...input,event:{...input.event,callerWallet:CHAIRMAN_WALLET}},0.003),{accepted:false,reason:'DUPLICATE_TOKEN'});
 assert.equal(engine.records.length,1);
 const closed=engine.close(engine.records[0].reservationKey,0.0024);
 assert.equal(closed.closed,true);
 assert.ok(Math.abs(engine.records[0].pnlUsd!-2)<1e-9);
 assert.deepEqual(await engine.observe(input,0.002),{accepted:false,reason:'DUPLICATE_TOKEN'});
});
test('paper-only flow rejects invalid price and unverified buy without reservations',async()=>{
 const engine=new EchoPaperTradeEngine();
 assert.deepEqual(await engine.observe(input,0),{accepted:false,reason:'INVALID_ENTRY_PRICE'});
 const rejected=await engine.observe({...input,event:{...input.event,isVerifiedSwap:false}},0.002);
 assert.equal(rejected.accepted,false);
 assert.equal(engine.records.length,0);
 assert.equal((await engine.observe(input,0.002)).accepted,true);
});

test('paper ledger survives restart without duplicate entry and persists close',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-paper-'));
 try{
  const file=join(dir,'paper.json');
  const first=new EchoPaperTradeEngine(10,file);
  assert.equal((await first.observe(input,0.002)).accepted,true);
  const restored=new EchoPaperTradeEngine(10,file);
  assert.equal(restored.records.length,1);
  assert.deepEqual(await restored.observe(input,0.002),{accepted:false,reason:'DUPLICATE_TOKEN'});
  assert.equal(restored.close(restored.records[0].reservationKey,0.003).closed,true);
  const again=new EchoPaperTradeEngine(10,file);
  assert.equal(again.records[0].status,'CLOSED');
  assert.equal(again.records[0].pnlUsd,5);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
