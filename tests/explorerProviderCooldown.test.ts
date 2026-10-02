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
test('429 respects bounded Retry-After and transient failures do not repeatedly hit the provider', async () => {
  let now = 1000, calls = 0;
  const reader = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000, clock: () => now,
    fetcher: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '9999' } }); } });
  await assert.rejects(reader.read('/wallet'), /HTTP 429/); now += 299_999;
  await assert.rejects(reader.read('/wallet'), /cooldown/); assert.equal(calls, 1);
  now++; await assert.rejects(reader.read('/wallet'), /HTTP 429/); assert.equal(calls, 2);
  let networkCalls = 0;
  const network = createExplorerJsonReader({ baseUrl: 'https://example.test', timeoutMs: 1000, clock: () => now,
    fetcher: async () => { networkCalls++; throw new Error('timeout'); } });
  await assert.rejects(network.read('/wallet'), /timeout/);
  await assert.rejects(network.read('/wallet'), /cooldown/); assert.equal(networkCalls, 1);
});
