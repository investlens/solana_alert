import test from 'node:test';import assert from 'node:assert/strict';
import { echoFreshPageBudget, echoFreshScanPlan } from '../src/echo/freshBudget.js';
import {advanceFreshScan,type FreshScanState} from '../src/echo/freshScan.js';
test('pending high volume fresh frontier gets bounded additional pages only with low pressure',()=>{
 assert.equal(echoFreshPageBudget(true,0),6);
 assert.equal(echoFreshPageBudget(true,15),6);
 assert.equal(echoFreshPageBudget(true,16),3);
 assert.equal(echoFreshPageBudget(true,64),3);
 assert.equal(echoFreshPageBudget(false,0),3);
 assert.throws(()=>echoFreshPageBudget(true,-1));
});
test('high-volume 550 signature burst reaches cutoff without skipping 30-minute evidence',()=>{
 let state:FreshScanState={checkpoint:null,before:null,candidate:null};
 let seen=0,done=false;
 for(let page=0;page<6;page++){
  const rows=Array.from({length:100},(_,i)=>({signature:String(700-page*100-i),blockTime:3000-page*100-i}));
  const p=advanceFreshScan(state,rows,100,2460);
  state=p.state;seen+=p.scanned.length;done=p.complete;
  if(done)break;
 }
 assert.equal(done,true);
 assert.equal(seen,541);
 assert.equal(state.checkpoint,'700');
 assert.equal(state.before,null);
});
test('malformed timestamp page never falsely completes or moves checkpoint',()=>{
 const s:FreshScanState={checkpoint:'x',before:null,candidate:null};
 const r=advanceFreshScan(s,Array.from({length:100},(_,i)=>({signature:String(500-i),blockTime:i===99?null:3000-i})),100,2000);
 assert.equal(r.complete,false);assert.equal(r.state.checkpoint,'x');
});

test('pending Slingoor uses fewer but wider pages at low queue pressure',()=>{
 const low=echoFreshScanPlan(true,true,0);
 assert.deepEqual(low,{pageLimit:1000,maxPages:2});
 assert.deepEqual(echoFreshScanPlan(true,false,0),{pageLimit:100,maxPages:3});
 assert.deepEqual(echoFreshScanPlan(true,true,16),{pageLimit:100,maxPages:1});
 assert.deepEqual(echoFreshScanPlan(false,true,0),{pageLimit:100,maxPages:6});
 assert.deepEqual(echoFreshScanPlan(true,true,0,true),{pageLimit:1000,maxPages:1});
 assert.deepEqual(echoFreshScanPlan(true,true,16,true),{pageLimit:100,maxPages:1});
 assert.deepEqual(echoFreshScanPlan(false,true,0,true),{pageLimit:100,maxPages:1});
 assert.throws(()=>echoFreshScanPlan(true,true,-1),/INVALID_QUEUE_SIZE/);
});
test('1000 signature pages resume after restart and reach persisted checkpoint without skipping',()=>{
 const head=Array.from({length:1000},(_,i)=>({signature:String(2300-i),blockTime:5000-i}));
 const tail=Array.from({length:400},(_,i)=>({signature:String(1300-i),blockTime:4000-i}));
 const initial:FreshScanState={checkpoint:'1000',before:null,candidate:null};
 const first=advanceFreshScan(initial,head,1000,3000);
 assert.equal(first.complete,false);
 assert.equal(first.scanned.length,1000);
 const recovered:FreshScanState=JSON.parse(JSON.stringify(first.state));
 const second=advanceFreshScan(recovered,tail,1000,3000);
 assert.equal(second.complete,true);
 assert.equal(second.state.checkpoint,'2300');
 assert.equal(second.cutoffWithoutCheckpoint,false);
 assert.equal(second.scanned.length,300);
 assert.equal(second.scanned.at(-1)?.signature,'1001');
});
test('signature without blockTime remains eligible for verification even before scan completes',()=>{
 const page=Array.from({length:100},(_,i)=>({signature:String(500-i),blockTime:i===10?null:2000-i}));
 const state:FreshScanState={checkpoint:'old',before:null,candidate:null};
 const result=advanceFreshScan(state,page,100,1500);
 assert.equal(result.complete,false);
 assert.ok(result.scanned.some(row=>row.signature==='490'));
});
