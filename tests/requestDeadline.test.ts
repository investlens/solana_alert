import test from 'node:test';
import assert from 'node:assert/strict';
import { abortable, createRequestGate, currentRequestSignal, fetchBuffered, throwIfRequestAborted, withRequestDeadline } from '../src/services/requestDeadline.js';

test('an operation which never resolves releases its caller at the deadline', async () => {
  await assert.rejects(withRequestDeadline(15, async () => new Promise<never>(() => {})), /deadline exceeded/);
  assert.equal(currentRequestSignal(), undefined);
});

test('late completion in an expired operation cannot start a downstream write', async () => {
  let complete!: () => void;
  let attempted = false;
  const late = new Promise<void>(resolve => { complete = resolve; });
  await assert.rejects(withRequestDeadline(15, async () => {
    await late; throwIfRequestAborted(); attempted = true;
  }));
  complete(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempted, false);
});

test('cancelled queue entries never consume a later permit', async () => {
  const gate = createRequestGate(1);
  const release = await gate(new AbortController().signal);
  const cancelled = new AbortController();
  const queued = gate(cancelled.signal); cancelled.abort(new Error('queue deadline'));
  await assert.rejects(queued, /queue deadline/);
  const next = gate(new AbortController().signal); release();
  const releaseNext = await next; releaseNext(); releaseNext();
  (await gate(new AbortController().signal))();
});

test('HTTP headers do not bypass the deadline when the response body stalls', async () => {
  const controller = new AbortController();
  const request = (async () => new Response(new ReadableStream({ start() {} }))) as typeof fetch;
  const pending = fetchBuffered('https://test.invalid', {}, controller.signal, request);
  controller.abort(new Error('body deadline'));
  await assert.rejects(pending, /body deadline/);
});

test('buffered responses retain JSON and status without a live network body', async () => {
  const request = (async () => new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const response = await fetchBuffered('https://test.invalid', {}, new AbortController().signal, request);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  const controller = new AbortController(); controller.abort(new Error('stopped'));
  await assert.rejects(abortable(Promise.resolve(1), controller.signal), /stopped/);
});
