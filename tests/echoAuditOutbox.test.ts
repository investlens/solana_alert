import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EchoAuditOutbox } from '../src/echo/auditOutbox.js';
import type { EchoAuditDelivery } from '../src/echo/auditWriter.js';

const sample:EchoAuditDelivery={
  signature:'3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1',
  callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
  mint:'BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump',
  caller:'WHALE · slingoor',tradeAt:1793336588,deliveredAt:1793336590,
  telegramMessageId:18431,quoteAmount:0.816665798,quoteSymbol:'SOL',tokenAmount:6713021.771928
};
test('audit queues on failed remote write, survives restart and sends once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-audit-'));const path=join(dir,'queue.json');
 try {
   const failed=new EchoAuditOutbox(path,async()=>false);await failed.load();
   assert.equal(await failed.enqueue(sample),true);
   assert.equal(await failed.enqueue(sample),true);
   assert.equal(failed.summary().queued,1);
   await failed.flush();assert.equal(failed.summary().queued,1);
   const sent:string[]=[];
   const recovered=new EchoAuditOutbox(path,async v=>{sent.push(v.signature);return true;});
   await recovered.load();assert.equal(recovered.summary().queued,1);
   await recovered.flush();assert.deepEqual(sent,[sample.signature]);assert.equal(recovered.summary().queued,0);
   const again=new EchoAuditOutbox(path,async()=>{throw Error('unexpected replay');});
   await again.load();assert.equal(again.summary().queued,0);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
test('audit rejects malformed records without contacting remote',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-audit-'));try{
  const outbox=new EchoAuditOutbox(join(dir,'q'),async()=>{throw Error('not called');});
  await outbox.load();
  assert.equal(await outbox.enqueue({...sample,mint:'invalid'}),false);
  assert.equal(outbox.summary().queued,0);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
