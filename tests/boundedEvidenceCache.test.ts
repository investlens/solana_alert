import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedEvidenceCache} from '../src/services/boundedEvidenceCache.js';
test('cards share an in-flight read and fresh evidence, never another creator or block',async()=>{
 let now=0,calls=0;
 const read=boundedEvidenceCache(async key=>{calls++;return {key,percent:0,observedAt:now};},()=>now);
 const [a,b]=await Promise.all([read('token:creator:block'),read('token:creator:block')]);
 assert.equal(a,b);assert.equal(calls,1);assert.equal(a?.percent,0);
 now=29_999;assert.equal(await read('token:creator:block'),a);assert.equal(calls,1);
 await read('token:other:block');await read('token:creator:otherBlock');assert.equal(calls,3);
 now=30_000;await read('token:creator:block');assert.equal(calls,4);
});
test('provider failure retries after short backoff and evicts bounded entries',async()=>{
 let now=0,calls=0;
 const read=boundedEvidenceCache(async key=>{calls++;if(key==='failed')throw Error('offline');return key;},()=>now);
 assert.equal(await read('failed'),null);await read('failed');assert.equal(calls,1);
 now=2_000;await read('failed');assert.equal(calls,2);
 for(let i=0;i<101;i++)await read(String(i));
 const before=calls;await read('0');assert.equal(calls,before+1);
});
