import test from 'node:test';import assert from 'node:assert/strict';
import {createReader,type ProviderConfig} from '../providers.js';
const config:ProviderConfig={rpc:{robinhood:'https://rpc.example',arc:'https://arc.example'},explorer:{robinhood:'https://api.blockscout.com/4663/api/v2',arc:'https://custom.example/api/v2'},explorerKey:'private-test-key'};
test('provider credentials go only to the official explorer host and never into URL query parameters',async()=>{
 const calls:{url:string;init:any}[]=[];const r=createReader(config,{fetch:async(url,init)=>{calls.push({url:String(url),init});return Response.json({items:[]});}});
 await r.explorer('robinhood','addresses/0xabc');await r.explorer('arc','addresses/0xabc');
 assert.equal(calls[0].init.headers.Authorization,'Bearer private-test-key');assert.equal(calls[1].init.headers.Authorization,undefined);
 assert.ok(calls.every(c=>!c.url.includes('private-test-key')));
});
test('RPC is read only, enforces request budgets and refuses redirects or oversized responses',async()=>{
 let requests=0;const r=createReader(config,{budget:1,fetch:async()=>{requests++;return Response.json({result:'0x1237'});}});
 await assert.rejects(r.rpc('robinhood','eth_sendRawTransaction',[]),/Read-only/);assert.equal(requests,0);
 assert.equal(await r.rpc('robinhood','eth_chainId',[]),'0x1237');await assert.rejects(r.rpc('robinhood','eth_chainId',[]),/budget/);assert.equal(requests,1);
 const large=createReader(config,{fetch:async()=>new Response('small',{headers:{'content-length':'262145'}})});await assert.rejects(large.pairs('robinhood','0xabc'),/too large/);
});
test('caller cancellation reaches simulation transport rather than extending the verifier deadline',async()=>{
 const controller=new AbortController();controller.abort();
 const r=createReader(config,{fetch:async(_url,init)=>{assert.equal(init?.signal?.aborted,true);throw Error('aborted');}});
 await assert.rejects(r.rpc('robinhood','eth_simulateV1',[],controller.signal),/aborted/);
});
