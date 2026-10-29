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
