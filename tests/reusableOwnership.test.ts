import test from 'node:test';
import assert from 'node:assert/strict';
import {reusableOwnership} from '../src/services/reusableOwnership.js';
test('shared ownership reuses fresh developer evidence without mixing venues or creators',()=>{
 const v={creator:'alice',devPercent:0,devObservedAt:10,top10Percent:40,top10Coverage:'INDEXED_SAMPLE' as const};
 const cache=new Map([['token:pool:alice',{at:100,value:v}]]);
 assert.equal(reusableOwnership(cache.entries(),'TOKEN',null,'other',101).devPercent,0);
 assert.equal(reusableOwnership(cache.entries(),'token',null,'other',101).top10Percent,null);
 assert.equal(reusableOwnership(cache.entries(),'token','bob','pool',101).devPercent,null);
 assert.equal(reusableOwnership(cache.entries(),'other',null,'pool',101).creator,undefined);
 assert.equal(reusableOwnership(cache.entries(),'token',null,'pool',30_100).devPercent,null);
 assert.equal(reusableOwnership(cache.entries(),'token','alice','pool',101).top10Percent,40);
});
