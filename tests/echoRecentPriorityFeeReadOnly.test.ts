import test from 'node:test';
import assert from 'node:assert/strict';
import {readEchoRecentPrioritizationFees} from '../src/echo/recentPriorityFeeReadOnly.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const fees=Array.from({length:12},(_,i)=>({slot:400000000+i,prioritizationFee:1000+i*200}));
test('RPC getRecentPrioritizationFees is one bounded, targeted read-only request',async()=>{
 let calls=0;
 const fetcher=(async(_url:string,options:RequestInit)=>{
  calls++;assert.equal(options.method,'POST');
  const q=JSON.parse(String(options.body));
  assert.equal(q.method,'getRecentPrioritizationFees');
  assert.deepEqual(q.params,[[wallet]]);
  assert.equal(JSON.stringify(q).includes('sendTransaction'),false);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:fees}),{status:200});
 }) as typeof fetch;
 const result=await readEchoRecentPrioritizationFees({
  rpcUrl:'https://api.mainnet-beta.solana.com',writableAccounts:[wallet],fetcher,nowMs:1800000000000});
 assert.equal(calls,1);assert.equal(result.samples.length,12);
 assert.equal(result.readOnly,true);assert.equal(result.rpcCalls,1);
});
test('429 does not retry or fall back in fee-sampling path',async()=>{
 let calls=0;const fetcher=(async()=>{calls++;return new Response('',{status:429})}) as typeof fetch;
 await assert.rejects(readEchoRecentPrioritizationFees({
  rpcUrl:'https://example.org/',writableAccounts:[wallet],fetcher}),/FEE_RPC_THROTTLED_NO_RETRY/);
 assert.equal(calls,1);
});
test('duplicate slots, oversized body and missing account fail closed',async()=>{
 const response=(rows:unknown)=>(async()=>new Response(JSON.stringify({result:rows}),{status:200})) as typeof fetch;
 await assert.rejects(readEchoRecentPrioritizationFees({
  rpcUrl:'https://example.org',writableAccounts:[wallet],fetcher:response([fees[0],fees[0],...fees])}),/INVALID_FEE_SAMPLE/);
 await assert.rejects(readEchoRecentPrioritizationFees({
  rpcUrl:'https://example.org',writableAccounts:[],fetcher:response(fees)}),/INVALID_WRITABLE_FEE_ACCOUNTS/);
 await assert.rejects(readEchoRecentPrioritizationFees({
  rpcUrl:'http://example.org',writableAccounts:[wallet],fetcher:response(fees)}),/INVALID_RPC_URL/);
});
