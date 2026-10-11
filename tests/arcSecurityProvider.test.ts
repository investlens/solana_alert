import test from 'node:test';import assert from 'node:assert/strict';
import {createArcSecurityLoader} from '../src/chains/arc/securityProvider.js';
const token='0x1111111111111111111111111111111111111111';
function loader(payloads:any[]){let calls=0;const run=createArcSecurityLoader({fetch:async()=>{const p=payloads[calls++];if(p instanceof Error)throw p;return new Response(JSON.stringify(p.body??p),{status:p.status??200});},wait:async()=>{}});return {run,calls:()=>calls};}
const clear={code:1,result:{[token]:{is_honeypot:'0',cannot_sell_all:'0'}}};
test('ARC transient 5000 and server errors retry once and can recover',async()=>{for(const error of [{code:5000,result:null},{status:503,body:{}},new Error('network')]){const x=loader([error,clear]);assert.equal((await x.run(token)).allowed,true);assert.equal(x.calls(),2);}});
test('repeated ARC provider error remains blocked with exact classification',async()=>{const x=loader([{code:5000},{code:5000}]);assert.match((await x.run(token)).reason,/error 5000/);assert.equal(x.calls(),2);});
test('missing restriction evidence is never manufactured or retried',async()=>{const x=loader([{code:1,result:{[token]:{is_honeypot:'0'}}}]);const r=await x.run(token);assert.equal(r.allowed,false);assert.match(r.reason,/cannot_sell_all/);assert.equal(x.calls(),1);});
test('confirmed restrictions block; rate limits and invalid payload code do not loop',async()=>{for(const payload of [{code:1,result:{[token]:{is_honeypot:'1'}}},{status:429,body:{}},{code:5000,result:clear.result}]){const x=loader([payload,payload]);assert.equal((await x.run(token)).allowed,false);assert.ok(x.calls()<=2);}});
