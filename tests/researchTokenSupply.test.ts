import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchSupplyReader } from '../src/services/researchTokenSupply.js';
const token = '0x1111111111111111111111111111111111111111';
const row = { chainId: 4663, decimals: 18, totalSupplyRaw: 1000n, blockNumber: 123n };
test('supply caches exact chain/address, preserves real zero and rejects mismatched chains', async () => {
  let calls = 0, now = 1_000;
  const read = createResearchSupplyReader(async () => { calls++; return row; }, () => now);
  assert.equal((await read(token, 'robinhood'))?.totalSupplyRaw, 1000n);
  await read(token.toUpperCase().replace('0X', '0x'), 'robinhood'); assert.equal(calls, 1);
  assert.equal(await read(token, 'arc'), null); assert.equal(calls, 2);
  now += 60_001; await read(token, 'robinhood'); assert.equal(calls, 3);
  const zero = createResearchSupplyReader(async () => ({ ...row, totalSupplyRaw: 0n }));
  assert.equal((await zero(token, 'robinhood'))?.totalSupplyRaw, 0n);
  const invalid = createResearchSupplyReader(async () => ({ ...row, decimals: -1 }));
  assert.equal(await invalid(token, 'robinhood'), null);
});
test('supply coalesces same-token requests and bounds concurrent lookups', async () => {
  let finish!: (value: typeof row) => void;
  const waiting = new Promise<typeof row>(resolve => { finish = resolve; });
  let calls = 0;
  const read = createResearchSupplyReader(async () => { calls++; return waiting; });
  const a = read(token, 'robinhood'), duplicate = read(token, 'robinhood');
  const b = read('0x2222222222222222222222222222222222222222', 'robinhood');
  const c = read('0x3333333333333333333333333333333333333333', 'robinhood');
  assert.equal(await read('0x4444444444444444444444444444444444444444', 'robinhood'), null);
  assert.equal(calls, 3); finish(row);
  assert.equal((await a)?.blockNumber, 123n); await Promise.all([duplicate, b, c]);
});
test('failed supply lookups are cached briefly; lookup budget cannot exceed ten per minute', async () => {
  let calls = 0, now = 1_000;
  const read = createResearchSupplyReader(async () => { calls++; throw new Error('unavailable'); }, () => now);
  await read(token, 'robinhood'); await read(token, 'robinhood'); assert.equal(calls, 1);
  now += 15_001; await read(token, 'robinhood'); assert.equal(calls, 2);
  for (let i = 1; i <= 20; i++) await read(`0x${i.toString(16).padStart(40, '0')}`, 'robinhood');
  assert.equal(calls, 10);
  now += 60_001; await read(token, 'robinhood'); assert.equal(calls, 11);
});
