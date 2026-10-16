import test from 'node:test';import assert from 'node:assert/strict';
import {verifiedDexReached,createDexReachedRecorder} from '../src/services/ponsDexReachedEvidence.js';
const token='0x'+'a'.repeat(40),pool='0x'+'b'.repeat(40),now=Date.now();
const stats={authoritativeVenue:true,preBond:false,price:1,liquidity:10,source:'DEXScreener · PONS-mapped graduated pool',chartUrl:'https://dexscreener.com/robinhood/'+pool};
test('only existing exact official-pool graduation evidence counts; paid orders or generic pairs do not',()=>{
 assert.equal(verifiedDexReached(token,stats,now)?.source,'PONS_V2_GRADUATED_MAPPED_POOL');
 for(const patch of [{preBond:true},{authoritativeVenue:false},{source:'DEXScreener'},{liquidity:0},{price:null},{chartUrl:'https://dexscreener.com/arc/'+pool}])assert.equal(verifiedDexReached(token,{...stats,...patch},now),null);
});
test('observation storage is asynchronous, bounded and coalesced without new network scans',async()=>{
 let clock=now,saves=0;const batches:any[]=[];
 const recorder=createDexReachedRecorder({now:()=>clock,save:async items=>{saves++;batches.push(items);return items.length;}});
 recorder.observe(token,stats);await recorder.flush();await new Promise(r=>setImmediate(r));assert.equal(saves,1);
 recorder.observe(token,stats);await recorder.flush();assert.equal(saves,1);
 for(let n=1;n<70;n++)recorder.observe('0x'+n.toString(16).padStart(40,'0'),stats);
 assert.ok(recorder.stats().pending<=50);clock+=60001;await recorder.flush();assert.equal(saves,2);assert.ok(batches[1].length<=10);
});
