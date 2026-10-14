import test from 'node:test';import assert from 'node:assert/strict';
import {createExitRpcTransport} from '../src/services/exitRpcTransport.js';
test('rate-limited provider falls back at the exact pinned block, with chain validation and cooldown',async()=>{
 let time=1000;const calls:{url:string;method:string;params:unknown[]}[]=[];
 const rpc=createExitRpcTransport({now:()=>time,chainId:()=>4663,urls:()=>['https://one','https://two'],fetch:async(url,init)=>{
  const b=JSON.parse(String(init?.body));calls.push({url:String(url),...b});
  if(b.method==='eth_chainId')return Response.json({result:'0x1237'});
  if(url==='https://one')return new Response('',{status:429});
  return Response.json({result:[{calls:[{status:'0x0'}]}]});
 }});
 const params=[{blockStateCalls:[]},'0x123456'],signal=AbortSignal.timeout(1000);
 assert.deepEqual(await rpc('robinhood','eth_simulateV1',params,signal),[{calls:[{status:'0x0'}]}]);
 assert.deepEqual(calls.map(c=>[c.url,c.method]),[['https://one','eth_chainId'],['https://one','eth_simulateV1'],['https://two','eth_chainId'],['https://two','eth_simulateV1']]);
 assert.deepEqual(calls.at(-1)?.params,params);
 calls.length=0;time+=1000;await rpc('robinhood','eth_simulateV1',params,signal);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://two');
});
test('wrong-chain endpoints never run a simulation; caller cancellation stops fallback',async()=>{
 let calls=0;const controller=new AbortController();
 const rpc=createExitRpcTransport({chainId:()=>4663,urls:()=>['https://one','https://two'],fetch:async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).method,'eth_chainId');return Response.json({result:'0x1'});}});
 await assert.rejects(rpc('robinhood','eth_simulateV1',[],controller.signal),/unavailable/);assert.equal(calls,2);
 controller.abort();await assert.rejects(rpc('robinhood','eth_chainId',[],controller.signal));assert.equal(calls,2);
 await assert.rejects(rpc('robinhood','eth_sendRawTransaction',[],AbortSignal.timeout(1000)),/not permitted/);
});
