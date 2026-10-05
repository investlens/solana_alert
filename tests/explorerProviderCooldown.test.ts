import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerJsonReader } from '../src/services/explorerProviderCooldown.js';
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
