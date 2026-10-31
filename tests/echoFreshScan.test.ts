import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFreshScan, type FreshScanState } from '../src/echo/freshScan.js';
const rows = (start:number,count:number) => Array.from({length:count},(_,i)=>({signature:String(start-i)}));
test('more than 100 new signatures are scanned across pages without advancing checkpoint early',()=>{
 let state:FreshScanState={checkpoint:'1',before:null,candidate:null};
 const first=advanceFreshScan(state,rows(250,100));
 assert.equal(first.complete,false);
 assert.equal(first.state.checkpoint,'1');
 state=JSON.parse(JSON.stringify(first.state)); // persisted and recovered after restart
 const second=advanceFreshScan(state,rows(150,100));
 assert.equal(second.complete,false);
 const third=advanceFreshScan(second.state,rows(50,50));
 assert.equal(third.complete,true);
 assert.equal(third.state.checkpoint,'250');
 assert.equal(third.scanned.at(-1)?.signature,'2');
});
test('checkpoint encountered midpage stops before duplicate',()=>{
 const result=advanceFreshScan({checkpoint:'98',before:null,candidate:null},rows(100,10));
 assert.deepEqual(result.scanned.map(r=>r.signature),['100','99']);
 assert.equal(result.state.checkpoint,'100');
});
test('empty page completes scan without inventing a checkpoint',()=>{
 const result=advanceFreshScan({checkpoint:null,before:null,candidate:null},[]);
 assert.equal(result.complete,true);
 assert.equal(result.state.checkpoint,null);
});
test('stalled pagination fails closed',()=>{
 assert.throws(()=>advanceFreshScan({checkpoint:'1',before:'151',candidate:'250'},rows(250,100).map((r,i)=>i===99?{signature:'151'}:r)),/stalled/);
});

test('completes the 30 minute fresh alert window on a time-ordered full page', () => {
 const state: FreshScanState={checkpoint:null,before:null,candidate:null};
 const rows=Array.from({length:100},(_,i)=>({signature:String(200-i),blockTime:2000-i*10}));
 const result=advanceFreshScan(state,rows,100,1200);
 assert.equal(result.complete,true);
 assert.equal(result.state.checkpoint,'200');
 assert.equal(result.state.before,null);
 assert.ok(result.scanned.every(row=>row.blockTime!>=1200));
 assert.equal(result.scanned.length,81);
});
test('incomplete timestamp evidence never advances the fresh checkpoint', () => {
 const initial:FreshScanState={checkpoint:'old',before:null,candidate:null};
 const page=Array.from({length:100},(_,i)=>({signature:String(200-i),blockTime:2000-i*10}));
 const missing=page.map((r,i)=>i===99?{...r,blockTime:null}:r);
 const result=advanceFreshScan(initial,missing,100,1200);
 assert.equal(result.complete,false);
 assert.equal(result.state.checkpoint,'old');
 const unsorted=page.map((r,i)=>i===98?{...r,blockTime:1900}:r);
 assert.equal(advanceFreshScan(initial,unsorted,100,1200).complete,false);
});
test('fresh checkpoint stays pinned across pages until an old boundary is proven', () => {
 const state:FreshScanState={checkpoint:null,before:null,candidate:null};
 const recent=Array.from({length:100},(_,i)=>({signature:String(200-i),blockTime:2000-i*3}));
 const first=advanceFreshScan(state,recent,100,1200);
 assert.equal(first.complete,false);
 const older=Array.from({length:100},(_,i)=>({signature:String(100-i),blockTime:1697-i*6}));
 const second=advanceFreshScan(first.state,older,100,1200);
 assert.equal(second.complete,true);
 assert.equal(second.state.checkpoint,'200');
});

test('time cutoff reports unverified historical checkpoint without claiming overlap', () => {
 const page=Array.from({length:100},(_,i)=>({signature:String(500-i),blockTime:2000-i*12}));
 const result=advanceFreshScan({checkpoint:'older-checkpoint',before:null,candidate:null},page,100,1200);
 assert.equal(result.complete,false);
 assert.equal(result.cutoffWithoutCheckpoint,true);
 assert.equal(result.state.checkpoint,'older-checkpoint');
 assert.equal(result.state.olderGapPending,true);
 const recovered:FreshScanState=JSON.parse(JSON.stringify(result.state));
 const nextPage=Array.from({length:100},(_,i)=>({signature:String(400-i),blockTime:800-i}));
 const continued=advanceFreshScan(recovered,nextPage,100,1200);
 assert.equal(continued.complete,false);
 assert.equal(continued.state.checkpoint,'older-checkpoint');
 assert.equal(continued.state.olderGapPending,true);
 const finalPage=[{signature:'300',blockTime:700},{signature:'older-checkpoint',blockTime:699}];
 const overlapCompleted=advanceFreshScan(continued.state,finalPage,100,1200);
 assert.equal(overlapCompleted.complete,true);
 assert.equal(overlapCompleted.state.checkpoint,'500');
 assert.equal(overlapCompleted.state.olderGapPending,false);
 const overlap=advanceFreshScan({checkpoint:'499',before:null,candidate:null},page,100,1200);
 assert.equal(overlap.cutoffWithoutCheckpoint,false);
});
