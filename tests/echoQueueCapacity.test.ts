import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EchoQueue } from '../src/echo/queue.js';
const signature=(i:number)=>'1'.repeat(80-String(i).length)+String(i);
test('full durable queue rejects new signatures without claiming acceptance',()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-queue-capacity-'));
 try {
  const path=join(dir,'pending.json');
  const queue=new EchoQueue(async()=>{},()=>1000,path);
  for(let i=0;i<4096;i++) assert.equal(queue.add(signature(i)),true);
  assert.equal(queue.size,4096);
  assert.equal(queue.add(signature(4096)),false);
  assert.equal(queue.dropped,1);
  assert.equal(queue.add(signature(10)),true);
  const restored=new EchoQueue(async()=>{},()=>1000,path);
  assert.equal(restored.size,4096);
  assert.equal(restored.add(signature(4096)),false);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
