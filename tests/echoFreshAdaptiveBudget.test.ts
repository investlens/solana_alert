import test from 'node:test';import assert from 'node:assert/strict';
import { echoFreshPageBudget } from '../src/echo/freshBudget.js';
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
