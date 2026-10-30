import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFreshScan, type FreshScanState } from '../src/echo/freshScan.js';
import { EchoQueue } from '../src/echo/queue.js';
import { previewEchoManualBuy,previewEchoManualSell } from '../src/echo/manualTradePreview.js';
import { SLINGOOR_WALLET } from '../src/echo/liveBuyPolicy.js';
import type { SecureEchoBuy } from '../src/echo/secureBuyGuard.js';
import { mkdtempSync,rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const mkRows=(start:number,n:number)=>Array.from({length:n},(_,i)=>({
 signature:(start-i).toString(36).padStart(64,'1'),blockTime:10000-Math.floor((1500-start+i)/20)
}));
test('high volume 1500-signature pagination across restart never commits unfinished frontier',()=>{
 const all=mkRows(1500,1500);let state:FreshScanState={checkpoint:null,before:null,candidate:null};
 let seen=0;
 for(let i=0;i<15;i++){
   const page=all.slice(i*100,i*100+100);
   const output=advanceFreshScan(state,page,100,9500);
   seen+=output.scanned.length;
   assert.equal(output.complete,false);
   assert.equal(output.state.checkpoint,null);
   state=JSON.parse(JSON.stringify(output.state));
 }
 const last=advanceFreshScan(state,[],100,9500);
 assert.equal(last.complete,true);assert.equal(seen,1500);
 assert.equal(last.state.checkpoint,all[0].signature);
});
test('fresh coverage only commits candidate when prior frontier is proven',()=>{
 const all=mkRows(700,500);
 let s:FreshScanState={checkpoint:all[399].signature,before:null,candidate:null};
 for(let i=0;i<4;i++){
   const result=advanceFreshScan(s,all.slice(i*100,i*100+100),100,9500);
   if(i<3)assert.equal(result.complete,false);
   else assert.equal(result.complete,true);
   s=result.state;
 }
 assert.equal(s.checkpoint,all[0].signature);
});
test('durable pending queue survives restart and blocks same signature duplicates',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-fresh-'));
 try{
  const p=join(dir,'queue.json');let delivered=0;let now=1000;
  const sig='3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1';
  const first=new EchoQueue(async()=>{throw Error('not processed');},()=>now,p);
  assert.equal(first.add(sig,true),true);assert.equal(first.add(sig,true),true);assert.equal(first.size,1);
  const recovered=new EchoQueue(async()=>{delivered++},()=>now,p);
  assert.equal(recovered.size,1);await recovered.tick();
  assert.equal(delivered,1);assert.equal(recovered.size,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
const secure:SecureEchoBuy={
 event:{callerWallet:SLINGOOR_WALLET,mint:'11111111111111111111111111111111',amountSol:0.05,
 side:'BUY',isVerifiedSwap:true,transactionSignature:'1'.repeat(64)},
 ownerWallet:'11111111111111111111111111111111',nowMs:10000,observedAtMs:9500,
 spentTodayLamports:0,walletBalanceLamports:200000000,reserveLamports:10000000,
 killSwitchEngaged:false,simulationPassed:true,quoteValid:true,mintAuthorityDisabled:true,
 freezeAuthorityDisabled:true,liquidityVerified:true,sellRouteVerified:true,
 slippageBps:100,landing:{computeUnitLimit:300000,microLamportsPerCu:100000}
};
test('manual previews authorize no transaction, require admin and persistent token reservation proof',()=>{
 assert.equal(previewEchoManualBuy(secure,false,false).admissibleForSimulation,false);
 assert.equal(previewEchoManualBuy(secure,true,true).reason,'TOKEN_ALREADY_RESERVED');
 assert.equal(previewEchoManualBuy(secure,true,false).admissibleForSimulation,true);
 assert.equal(previewEchoManualBuy(secure,true,false).executionEnabled,false);
 assert.equal(previewEchoManualBuy({...secure,event:{...secure.event,amountSol:.11}},true,false).admissibleForSimulation,false);
 assert.equal(previewEchoManualSell({adminAuthorized:false,percent:100,confirmedTokenBalance:true,
 freshSellQuote:true,simulationPassed:true}).admissibleForSimulation,false);
 const sale=previewEchoManualSell({adminAuthorized:true,percent:100,confirmedTokenBalance:true,
 freshSellQuote:true,simulationPassed:true});
 assert.equal(sale.admissibleForSimulation,true);assert.equal(sale.executionEnabled,false);assert.equal(sale.autoSellEnabled,false);
});
