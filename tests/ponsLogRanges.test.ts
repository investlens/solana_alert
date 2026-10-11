import test from 'node:test';
import assert from 'node:assert/strict';
import {ponsLogRange,PONS_LOG_RANGE_BLOCKS} from '../src/chains/robinhood/ponsLogRanges.js';
test('PONS provenance ranges stay within provider limits and cover history without gaps',()=>{
 const start=8_600_612n,end=85_544_142n;
 let cursor:bigint|null=end,previous=start-1n,count=0;
 while(cursor!=null){
  const range=ponsLogRange(start,cursor)!;
  assert.ok(range.to-range.from+1n<=PONS_LOG_RANGE_BLOCKS);
  assert.equal(range.to,cursor);
  if(count)assert.equal(range.to,previous-1n);
  previous=range.from;cursor=range.next;count++;
 }
 assert.equal(previous,start);assert.ok(count>1);
 assert.equal(ponsLogRange(start,start-1n),null);
});
