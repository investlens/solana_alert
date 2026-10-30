import test from 'node:test';
import assert from 'node:assert/strict';
import { EchoQueue } from '../src/echo/queue.js';

test('live Slingoor signature processes before previously queued history', async () => {
  const events: string[] = [];
  const q = new EchoQueue(async signature => { events.push(signature); }, () => 12345);
  const recovered = '3'.repeat(88), live = '4'.repeat(88);
  q.add(recovered);
  q.add(live, true);
  await q.tick();
  assert.deepEqual(events, [live]);
  await q.tick();
  assert.deepEqual(events, [live,recovered]);
});
test('same signature is promoted, not duplicated, when websocket catches up', async () => {
  const events: string[] = [];
  const q = new EchoQueue(async signature => { events.push(signature); }, () => 12345);
  const a = '3'.repeat(88), b = '4'.repeat(88);
  q.add(a);
  q.add(b);
  q.add(b,true);
  assert.equal(q.size,2);
  await q.tick();
  assert.deepEqual(events,[b]);
});
