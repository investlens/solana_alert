import test from 'node:test';
import assert from 'node:assert/strict';
import {EchoQueue} from '../src/echo/queue.js';
// Offline capacity and scheduling check only. Does not measure production
// network latency, Telegram acceptance, provider failures or real queue pressure.
const mintSig=(n:number)=>'3'.repeat(72)+String(n).padStart(10,'0').split('').map(c=>'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Number(c)]).join('');
test('fresh live Slingoor BUY preempts 1000 historical signature jobs',async()=>{
 const observed:string[]=[];
 const queue=new EchoQueue(async signature=>{observed.push(signature)});
 for(let i=0;i<1000;i++)assert.equal(queue.add(mintSig(i)),true);
 const fresh=mintSig(1001);
 assert.equal(queue.add(fresh,true),true);
 assert.equal(queue.size,1001);
 await queue.tick();
 assert.deepEqual(observed,[fresh]);
 assert.equal(queue.dropped,0);
 assert.equal(queue.size,1000);
});
test('duplicate replay never adds another pending job or drops the high-priority event',async()=>{
 const processed:string[]=[];
 const queue=new EchoQueue(async signature=>{processed.push(signature)});
 const one=mintSig(1800);
 assert.equal(queue.add(one,false),true);
 assert.equal(queue.add(one,true),true);
 assert.equal(queue.size,1);
 await queue.tick();
 assert.deepEqual(processed,[one]);
 assert.equal(queue.dropped,0);
});
