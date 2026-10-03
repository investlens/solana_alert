import test from 'node:test';
import assert from 'node:assert/strict';
import {getRobinhoodContractReport} from '../src/bot/contractScreening.js';
test('prefetched chain detection avoids a second market request and unavailable enrichment preserves a report',async()=>{
 const previous=globalThis.fetch;let marketCalls=0;
 globalThis.fetch=(async(input)=>{
  if(String(input).includes('api.dexscreener.com'))marketCalls++;
  return new Response('unavailable',{status:503});
 }) as typeof fetch;
 try {
  const report=await getRobinhoodContractReport('0x7777777777777777777777777777777777777777',true,[]);
  assert.equal(marketCalls,0);assert.match(report.text,/Indexed market data could not be verified/);
  assert.match(report.text,/risks not assessed/);assert.doesNotMatch(report.text,/SAFE|MC  <b>\$0/);
 }finally{globalThis.fetch=previous;}
});
