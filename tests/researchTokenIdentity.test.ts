import test from 'node:test';import assert from 'node:assert/strict';
import {createTokenIdentityReader} from '../src/services/researchTokenIdentity.js';
const token='0x'+'a'.repeat(40);
test('identity reads coalesce and cache independently of market data',async()=>{
 let calls=0;const reader=createTokenIdentityReader(async()=>{calls++;return {name:'Project',symbol:'PRO'};});
 const rows=await Promise.all([reader(token),reader(token.toUpperCase().replace('0X','0x'))]);
 assert.deepEqual(rows,[{name:'Project',symbol:'PRO'},{name:'Project',symbol:'PRO'}]);assert.equal(calls,1);
 await reader(token);assert.equal(calls,1);assert.deepEqual(await reader('bad'),{});
});
test('invalid identity fields are rejected and failed reads expire quickly',async()=>{
 let calls=0,now=100000;const reader=createTokenIdentityReader(async()=>{calls++;return calls===1?{name:'bad\u0000',symbol:'X'.repeat(40)}:{symbol:'GOOD'};},()=>now);
 assert.deepEqual(await reader(token),{});now+=11000;assert.deepEqual(await reader(token),{symbol:'GOOD'});assert.equal(calls,2);
});
