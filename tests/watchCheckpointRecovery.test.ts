import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchCheckpointRecovery, checkpointFailureReason } from '../src/services/watchCheckpointRecovery.js';

test('failed recovery never overwrites watches and retries before saving', async () => {
  let reads = 0; let writes = 0;
  const checkpoint = watchCheckpointRecovery(async () => { if (++reads === 1) throw new Error('timeout'); }, async () => { writes++; }, 'test');
  await checkpoint(); assert.equal(writes, 0);
  await checkpoint(); assert.equal(reads, 2); assert.equal(writes, 1);
  await checkpoint(); assert.equal(reads, 2); assert.equal(writes, 2);
});
test('independent feeds can recover while another remains unavailable', async () => {
  let writes = 0;
  const failed = watchCheckpointRecovery(async () => { throw new Error('offline'); }, async () => { throw new Error('must not save'); }, 'offline');
  const healthy = watchCheckpointRecovery(async () => {}, async () => { writes++; }, 'healthy');
  await Promise.all([failed(), healthy()]); assert.equal(writes, 1);
});
test('failed save does not stop polling and is retried', async () => {
  let writes = 0; let reads = 0;
  const checkpoint = watchCheckpointRecovery(async () => { reads++; }, async () => { if (++writes === 1) throw new Error('write timeout'); }, 'test');
  await checkpoint(); await checkpoint();
  assert.equal(writes, 2); assert.equal(reads, 1);
});

test('checkpoint diagnostics classify failures without exposing credentials',()=>{
 assert.equal(checkpointFailureReason(new Error('Watch checkpoint read timeout')),'STORE_TIMEOUT');
 assert.equal(checkpointFailureReason(new Error('Watch checkpoint store unavailable')),'STORE_UNAVAILABLE');
 assert.equal(checkpointFailureReason(new Error('Invalid watch checkpoint response')),'INVALID_CHECKPOINT');
 assert.equal(checkpointFailureReason(new Error('redis://user:secret@private')),'RECOVERY_FAILED');
});
