import test from 'node:test';import assert from 'node:assert/strict';
import {createSupplyJourneyRpc} from '../src/services/supplyJourneyRpc.js';
test('research RPC makes one request, forwards cancellation and rejects mutations',async()=>{
 let calls=0;const controller=new AbortController();
 const rpc=createSupplyJourneyRpc('https://rpc.example',async(_url,init)=>{calls++;assert.equal(init?.signal,controller.signal);return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x1237'}));});
 assert.equal(await rpc('eth_chainId',[],controller.signal),'0x1237');assert.equal(calls,1);
 await assert.rejects(rpc('eth_sendRawTransaction',[]));assert.equal(calls,1);
});
test('research RPC never retries failed, malformed or oversized responses',async()=>{
 for(const response of [new Response('unavailable',{status:503}),new Response('{}'),new Response(JSON.stringify({jsonrpc:'2.0',id:2,result:'0x1'})),new Response('x'.repeat(256001))]){
  let calls=0;const rpc=createSupplyJourneyRpc('https://rpc.example',async()=>{calls++;return response;});
  await assert.rejects(rpc('eth_chainId',[]));assert.equal(calls,1);
 }
});
