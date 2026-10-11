import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreArcBoostTotals} from '../src/chains/arc/boostCheckpoint.js';
const token='0x'+'a'.repeat(40),now=2000000000000;
test('ARC checkpoint accepts only recent bounded observed totals',()=>{
 assert.equal(restoreArcBoostTotals({at:now-300000,totals:[[token.toUpperCase().replace('0X','0x'),30]]},now).get(token),30);
 for(const at of [now-300001,now+1])assert.equal(restoreArcBoostTotals({at,totals:[[token,30]]},now).size,0);
 assert.equal(restoreArcBoostTotals({at:now,totals:[[token,NaN],['bad',30],[token,-1]]},now).size,0);
 const rows=Array.from({length:150},(_,i)=>['0x'+i.toString(16).padStart(40,'0'),i]);
 assert.equal(restoreArcBoostTotals({at:now,totals:rows},now).size,100);
});

import {processArcBoostObservation} from '../src/chains/arc/boostSafety.js';
test('restored lower total recovers an increase once without replaying equal or older feed entries',async()=>{
 const totals=restoreArcBoostTotals({at:now-60000,totals:[[token,20]]},now),events:string[]=[];
 const deliver=async(event:string)=>{events.push(event);return true;};
 for(const total of [20,30,30,20])await processArcBoostObservation(totals,{tokenAddress:token,totalAmount:total},deliver);
 assert.deepEqual(events,['INCREASE']);assert.equal(totals.get(token),30);
});
