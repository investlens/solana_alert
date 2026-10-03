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
test('cross-chain prefetched pairs cannot supply Robinchain valuation', async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=(async()=>new Response('unavailable',{status:503})) as typeof fetch;
 const token='0x8888888888888888888888888888888888888888';
 try {
  const report=await getRobinhoodContractReport(token,true,[
   {chainId:'arc',baseToken:{address:token,symbol:'WRONG'},marketCap:999999,priceUsd:'9',liquidity:{usd:999999}},
   {chainId:'robinhood',baseToken:{address:token,symbol:'RIGHT'},marketCap:12345,priceUsd:'0.0001',liquidity:{usd:2345}}
  ]);
  assert.match(report.text,/RIGHT/);assert.match(report.text,/12\.3K/);
  assert.doesNotMatch(report.text,/WRONG|999\.9K/);
 }finally{globalThis.fetch=previous;}
});
