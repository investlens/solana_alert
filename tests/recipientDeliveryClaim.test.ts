import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireRecipientClaim, RECIPIENT_CLAIM, RECIPIENT_FINISH, retryTelegramRejection,
  telegramExplicitRejection } from '../src/services/recipientDeliveryClaim.js';

// Models atomic Redis execution, including writes that succeed before timeout.
function store() {
  const values = new Map<string,string>(); let timeoutAfterWrite = false;
  const atomic = async (script:string, keys:string[], args:string[]):Promise<unknown> => {
    const key=keys[0], current=values.get(key);
    if (script===RECIPIENT_CLAIM) {
      if (!current || current===args[0]) {
        values.set(key,args[0]);
        if (timeoutAfterWrite) { timeoutAfterWrite=false; throw Error('deadline'); }
        return 'CLAIMED';
      }
      return current.startsWith('DELIVERED:')?'DELIVERED':'UNCONFIRMED';
    }
    assert.equal(script,RECIPIENT_FINISH);
    if(current!==args[0])return 0;
    if(args[1]==='RELEASE')values.delete(key);else values.set(key,args[1]);
    return 1;
  };
  return {values,atomic, timeout:()=>{timeoutAfterWrite=true;}};
}
const noWait = async()=>{};
test('a cache timeout after a successful claim recovers its owner and confirms delivery',async()=>{
  const cache=store(); cache.timeout();
  const claim=await acquireRecipientClaim('event','admin',cache.atomic,noWait);
  assert.equal(claim.state,'CLAIMED');
  if(claim.state==='CLAIMED')await claim.finish(123);
  assert.equal((await acquireRecipientClaim('event','admin',cache.atomic,noWait)).state,'DELIVERED');
  assert.equal((await acquireRecipientClaim('event','other',cache.atomic,noWait)).state,'CLAIMED');
});
test('concurrent workers send once and report an unconfirmed claim rather than assume success',async()=>{
  const cache=store();
  const claims=await Promise.all([acquireRecipientClaim('event','admin',cache.atomic,noWait),
    acquireRecipientClaim('event','admin',cache.atomic,noWait)]);
  assert.deepEqual(claims.map(c=>c.state),['CLAIMED','UNCONFIRMED']);
});
test('release is owner fenced and allows a retry only for a known non-send',async()=>{
  const cache=store(), claim=await acquireRecipientClaim('event','admin',cache.atomic,noWait);
  if(claim.state!=='CLAIMED')throw Error('missing claim');
  await claim.release();
  const next=await acquireRecipientClaim('event','admin',cache.atomic,noWait);
  await claim.release(); // Old worker cannot delete the new worker's claim.
  assert.equal((await acquireRecipientClaim('event','admin',cache.atomic,noWait)).state,'UNCONFIRMED');
  if(next.state==='CLAIMED')await next.finish(9);
  assert.equal((await acquireRecipientClaim('event','admin',cache.atomic,noWait)).state,'DELIVERED');
});
test('unavailable store is a visible failure after bounded attempts, never permission to send',async()=>{
  let calls=0;
  await assert.rejects(acquireRecipientClaim('event','admin',async()=>{calls++;throw Error('offline');},noWait),/offline/);
  assert.equal(calls,3);
});
test('legacy claims remain unconfirmed and are not blindly resent',async()=>{
  const cache=store();cache.values.set('alphaos:dex:delivery:event:admin','claimed');
  assert.equal((await acquireRecipientClaim('event','admin',cache.atomic,noWait)).state,'UNCONFIRMED');
});
test('Telegram rate limit retries without replaying an accepted or ambiguous send',async()=>{
  let calls=0;
  assert.equal(await retryTelegramRejection(async()=>{if(++calls<3)throw Error('Telegram send failed: 429 retry_after: 1');return 7;},noWait),7);
  assert.equal(calls,3);
  calls=0;
  await assert.rejects(retryTelegramRejection(async()=>{calls++;throw Error('fetch timeout');},noWait),/timeout/);
  assert.equal(calls,1);
  assert.equal(telegramExplicitRejection(Error('Telegram delivery rejected: 403 bot blocked')),true);
  assert.equal(telegramExplicitRejection(Error('fetch timeout')),false);
});
