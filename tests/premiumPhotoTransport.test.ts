import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramWithMessageId, editTelegramMessage } from '../src/services/telegram.js';

test('bounded automatic cards send photos; navigation stays text', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    methods.push(url.split('/').at(-1)!);
    if (url.endsWith('/sendPhoto')) assert.ok(init.body instanceof FormData);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 12 } }));
  });
  assert.equal(await sendTelegramWithMessageId('1', '<b>🚀 BOOST DETECTED</b>\n<b>$TEST</b>\nInformation only · DYOR'), 12);
  await sendTelegramWithMessageId('1', 'Choose a workspace');
  assert.deepEqual(methods, ['sendPhoto', 'sendMessage']);
});
test('enrichment edits a photo caption after an explicit no-text rejection', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    methods.push(url.split('/').at(-1)!);
    return url.endsWith('/editMessageText')
      ? new Response(JSON.stringify({ ok: false, description: 'Bad Request: there is no text in the message to edit' }), { status: 400 })
      : new Response(JSON.stringify({ ok: true }));
  });
  await editTelegramMessage('1', 12, 'Enriched data');
  assert.deepEqual(methods, ['editMessageText', 'editMessageCaption']);
});
