import test from 'node:test';import assert from 'node:assert/strict';import {restorePendingArcBoosts} from '../src/chains/arc/pendingBoosts.js';
test('only bounded genuine undelivered boost increases survive a short restart',()=>{
 const now=2000000,valid={tokenAddress:'0x'+'a'.repeat(40),amount:10,totalAmount:30,previous:20,at:now-1000};
 assert.deepEqual(restorePendingArcBoosts([valid],now),[valid]);
 for(const row of [{...valid,at:0},{...valid,at:now+1},{...valid,previous:30},{...valid,totalAmount:NaN},{...valid,tokenAddress:'invalid'}])assert.equal(restorePendingArcBoosts([row],now).length,0);
 assert.equal(restorePendingArcBoosts(Array(120).fill(valid),now).length,100);
});
