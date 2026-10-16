import test from 'node:test';import assert from 'node:assert/strict';
import {createRecoveryAuditQueue} from '../src/services/recoveryAuditQueue.js';
type Task={key:string;users:string[]};
const merge=(a:Task,b:Task)=>({key:a.key,users:[...new Set([...a.users,...b.users])]});
test('concurrent accepted recipient batches are serialized rather than discarded',async()=>{
 let release!:()=>void;const held=new Promise<void>(r=>release=r);const writes:Task[]=[];
 const queue=createRecoveryAuditQueue<Task>({now:Date.now,key:t=>t.key,merge,write:async t=>{writes.push(t);if(writes.length===1)await held;},failure:()=>{throw Error('unexpected');}});
 const first=queue.enqueue({key:'boost',users:['1','2','3','4','5','6']});
 const second=queue.enqueue({key:'boost',users:['7','8']});queue.enqueue({key:'boost',users:['9','10']});
 release();await Promise.all([first,second]);
 assert.equal(writes.length,2);assert.equal(new Set(writes.flatMap(x=>x.users)).size,10);assert.equal(queue.stats().pending,0);
});
test('database outage retains bounded work and waits for a later enqueue after cooldown',async()=>{
 let now=0,calls=0,errors=0;const written:Task[]=[];
 const queue=createRecoveryAuditQueue<Task>({now:()=>now,key:t=>t.key,merge,write:async t=>{calls++;if(calls===1)throw Error('offline');written.push(t);},failure:()=>{errors++;}});
 await queue.enqueue({key:'boost',users:['1']});assert.equal(errors,1);assert.equal(queue.stats().pending,1);
 await queue.enqueue({key:'boost',users:['2']});assert.equal(calls,1);
 now=60001;await queue.enqueue({key:'dex',users:['3']});assert.equal(calls,3);assert.deepEqual(written[0].users,['1','2']);
});
test('audit outage queue expires stale facts and remains capped at ten events',async()=>{
 let now=0;const queue=createRecoveryAuditQueue<Task>({now:()=>now,key:t=>t.key,merge,write:async()=>{throw Error('offline');},failure:()=>{}});
 await queue.enqueue({key:'0',users:[]});for(let i=1;i<20;i++)await queue.enqueue({key:String(i),users:[]});assert.equal(queue.stats().pending,10);
 now=300001;await queue.enqueue({key:'new',users:[]});assert.equal(queue.stats().pending,1);
});
