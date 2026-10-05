import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerJsonReader } from '../src/services/explorerProviderCooldown.js';
test('large transaction pages remain complete and coalesced without enlarging the cache', async () => {
  let calls = 0;
  const payload = { items: [{ hash: 'first', decoded_input: 'x'.repeat(300_000) }, { hash: 'last' }], next_page_params: { block_number: 123 } };
  const reader = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000,
    fetcher: async () => { calls++; return Response.json(payload); } });
  const [a, b] = await Promise.all([reader.read('/transactions'), reader.read('/transactions')]);
  assert.deepEqual(a, payload); assert.deepEqual(b, payload); assert.equal(calls, 1);
  assert.deepEqual(await reader.read('/transactions'), payload); assert.equal(calls, 2);
});

test('oversized streamed bodies are cancelled before consumption and never cached', async () => {
  let cancelled = 0, calls = 0, chunks = 0;
  const reader = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000,
    fetcher: async () => { calls++; return new Response(new ReadableStream<Uint8Array>({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(600_000)); },
      cancel() { cancelled++; },
    }), { headers: { 'content-type': 'application/json' } }); } });
  await assert.rejects(reader.read('/huge'), /download budget/);
  assert.equal(cancelled, 1); assert.ok(chunks <= 5);
  await assert.rejects(reader.read('/huge'), /download budget/); assert.equal(calls, 2);
});

test('stream decoding preserves split UTF-8 and malformed JSON is not cached', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({ symbol: '🪙' }));
  const reader = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000,
    fetcher: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte)); controller.close();
    } }), { headers: { 'content-type': 'application/json' } }) });
  assert.deepEqual(await reader.read('/unicode'), { symbol: '🪙' });
  let calls = 0;
  const malformed = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000,
    fetcher: async () => { calls++; return new Response('{bad', { headers: { 'content-type': 'application/json' } }); } });
  await assert.rejects(malformed.read('/bad'), SyntaxError);
  await assert.rejects(malformed.read('/bad'), SyntaxError); assert.equal(calls, 2);
});
test('403 opens one shared cooldown and allows a recovery probe after five minutes', async () => {
  let now = 1000, calls = 0;
  const reader = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000, clock: () => now,
    fetcher: async () => { calls++; return calls === 1 ? new Response('', { status: 403 }) : Response.json({ items: [] }); } });
  await assert.rejects(reader.read('/wallet-a'), /HTTP 403/);
  await assert.rejects(reader.read('/wallet-b'), /cooldown/);
  assert.throws(() => reader.assertAvailable(), /live block fallback/); assert.equal(calls, 1);
  now += 300_000;
  assert.deepEqual(await reader.read('/wallet-a'), { items: [] }); assert.equal(calls, 2);
});
test('429 respects long Retry-After and transient failures do not repeatedly hit the provider', async () => {
  let now = 1000, calls = 0;
  const reader = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000, clock: () => now,
    fetcher: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '9999' } }); } });
  await assert.rejects(reader.read('/wallet'), /HTTP 429/); now += 9_998_999;
  await assert.rejects(reader.read('/wallet'), /cooldown/); assert.equal(calls, 1);
  now++; await assert.rejects(reader.read('/wallet'), /HTTP 429/); assert.equal(calls, 2);
  let networkCalls = 0;
  const network = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000, clock: () => now,
    fetcher: async () => { networkCalls++; throw new Error('timeout'); } });
  await assert.rejects(network.read('/wallet'), /timeout/);
  await assert.rejects(network.read('/wallet'), /cooldown/); assert.equal(networkCalls, 1);
});

test('same-path readers share one request and cached JSON is independently readable', async () => {
  let calls = 0;
  const reader = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000,
    fetcher: async () => { calls++; return Response.json({ items: [{ value: '1' }] }); } });
  const [a, b] = await Promise.all([reader.read('/holders'), reader.read('/holders')]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  assert.deepEqual(await reader.read('/holders'), a); assert.equal(calls, 1);
});

test('official keyed route preserves query pagination and never leaks key to custom hosts',async()=>{
 const urls:string[]=[];
 const reader=createExplorerJsonReader({baseUrl:'https://api.blockscout.com/4663/api/v2',apiKey:'test-key',timeoutMs:1000,fetcher:async input=>{urls.push(String(input));return Response.json({items:[]});}});
 await reader.read('/addresses/0xabc/transactions?block_number=123');
 const u=new URL(urls[0]);assert.equal(u.searchParams.get('block_number'),'123');assert.equal(u.searchParams.get('apikey'),'test-key');
 const custom=createExplorerJsonReader({baseUrl:'https://custom.example/api/v2',apiKey:'test-key',timeoutMs:1000,fetcher:async input=>{assert.ok(!String(input).includes('test-key'));return Response.json({});}});
 await custom.read('/address');
});
