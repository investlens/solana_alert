import test from 'node:test';
import assert from 'node:assert/strict';
import { createEchoAuditWriter,echoAuditRow,type EchoAuditDelivery } from '../src/echo/auditWriter.js';
const sample:EchoAuditDelivery={
 signature:'3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1',
 callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 mint:'BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump',
 caller:'WHALE · slingoor',tradeAt:1793336588,deliveredAt:1793336590.088,
 telegramMessageId:18431,quoteAmount:.816665798,quoteSymbol:'SOL',tokenAmount:6713021.771928
};
test('disabled Supabase shadow write makes zero external requests',async()=>{
 let called=false;
 const audit=createEchoAuditWriter({},async()=>{called=true;throw Error('must not call');});
 assert.equal(audit.enabled,false);
 assert.equal(await audit.write(sample),false);
 assert.equal(called,false);
});
test('no unsafe credentials accepted when audit explicitly enabled',()=>{
 assert.throws(()=>createEchoAuditWriter({ECHO_AUDIT_SUPABASE_ENABLED:'true'}));
});
test('real Slingoor signature produces normalized idempotent audit record',()=>{
 const row=echoAuditRow(sample);
 assert.ok(row);
 assert.equal(row?.side,'BUY');
 assert.equal(row?.telegram_message_id,18431);
 assert.equal(row?.quote_amount,.816665798);
 assert.equal(row?.signature,sample.signature);
 assert.equal(echoAuditRow({...sample,telegramMessageId:0}),null);
 assert.equal(echoAuditRow({...sample,mint:'BAD'}),null);
});
test('enabled audit uses service-only REST endpoint; failures never throw',async()=>{
 let calls=0;
 const env={ECHO_AUDIT_SUPABASE_ENABLED:'true',ECHO_AUDIT_SUPABASE_URL:'https://test-project.supabase.co',
  ECHO_AUDIT_SUPABASE_SERVICE_KEY:'a'.repeat(40)};
 const audit=createEchoAuditWriter(env,async(url,opts)=>{
  calls++;
  assert.match(String(url),/echo_caller_alert_audit\?on_conflict=/);
  const body=JSON.parse(String(opts?.body));
  assert.equal(body.telegram_message_id,18431);
  assert.equal((opts?.headers as any).prefer,'resolution=ignore-duplicates,return=minimal');
  return {ok:true} as Response;
 });
 assert.equal(await audit.write(sample),true);
 assert.equal(calls,1);
 const bad=createEchoAuditWriter(env,async()=>{throw Error('transient network outage');});
 assert.equal(await bad.write(sample),false);
});
