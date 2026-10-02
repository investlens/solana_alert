import test from 'node:test';
import assert from 'node:assert/strict';
import { createBufferedPonsLiveStorage } from '../src/chains/robinhood/ponsBufferedLiveStorage.js';
import { getPonsFactoryDeployments } from '../src/chains/robinhood/ponsContracts.js';
import type { PonsLaunch } from '../src/chains/robinhood/ponsHistoricalLaunchScanner.js';
const factory = getPonsFactoryDeployments().find(row => row.id === 'v2-current')!;
const launch = (index: number) => ({ chain: 'robinhood', factory_address: factory.address,
  token_address: `token${index}`, transaction_hash: `tx${index}`, log_index: index } as PonsLaunch);

test('buffered storage reads checkpoint once and writes progress at most every five minutes', async () => {
  let time = 0, reads = 0; const writes: bigint[] = [];
  const storage = createBufferedPonsLiveStorage({ getLiveCheckpoint: async () => { reads++; return 10n; },
    persistLaunches: async () => {}, setLiveCheckpoint: async (_factory, block) => { writes.push(block); } }, { now: () => time, log: () => {} });
  assert.equal(await storage.getLiveCheckpoint(factory.id), 10n);
  await storage.setLiveCheckpoint(factory, 20n);
  time = 10_000; await storage.setLiveCheckpoint(factory, 30n);
  assert.equal(await storage.getLiveCheckpoint(factory.id), 30n); assert.equal(reads, 1);
  time = 300_000; await storage.setLiveCheckpoint(factory, 40n);
  assert.deepEqual(writes, [20n, 40n]);
});

test('failed census writes retry without new launches and never checkpoint past pending facts', async () => {
  let time = 0, calls = 0; const stored: PonsLaunch[][] = [], checkpoints: bigint[] = [];
  const storage = createBufferedPonsLiveStorage({ getLiveCheckpoint: async () => 0n,
    persistLaunches: async rows => { calls++; if (calls === 1) throw new Error('DB unavailable'); stored.push(rows); },
    setLiveCheckpoint: async (_factory, block) => { checkpoints.push(block); } }, { now: () => time, log: () => {} });
  await storage.persistLaunches([launch(1)]); await storage.setLiveCheckpoint(factory, 20n);
  time = 30_000; await storage.persistLaunches([launch(1), launch(2)]);
  assert.equal(calls, 1); assert.deepEqual(checkpoints, []);
  time = 60_000; await storage.setLiveCheckpoint(factory, 30n);
  assert.equal(stored[0].length, 2); assert.deepEqual(checkpoints, [30n]);
});

test('outage buffer is capped and explicitly reports incomplete coverage', async () => {
  let time = 0; const lines: string[] = []; let saved = 0;
  const storage = createBufferedPonsLiveStorage({ getLiveCheckpoint: async () => 0n,
    persistLaunches: async rows => { if (!time) throw new Error('offline'); saved = rows.length; },
    setLiveCheckpoint: async () => {} }, { capacity: 2, now: () => time, log: line => lines.push(line) });
  await storage.persistLaunches([launch(1), launch(2), launch(3)]);
  assert.ok(lines.some(line => line.includes('coverage incomplete')));
  time = 60_000; await storage.setLiveCheckpoint(factory, 20n); assert.equal(saved, 2);
});
