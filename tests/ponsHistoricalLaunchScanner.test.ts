import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, parseAbiParameters } from 'viem';
import { getPonsFactoryDeployments } from '../src/chains/robinhood/ponsContracts.js';
import { aggregatePonsDevelopers } from '../src/chains/robinhood/ponsDeveloperReport.js';
import { buildChunkBoundaries, decodePonsLaunch, launchIdentity, scanPonsLaunches, type PonsRpcLog } from '../src/chains/robinhood/ponsHistoricalLaunchScanner.js';
import { createPonsLaunchStorage } from '../src/chains/robinhood/ponsLaunchStorage.js';

const token = '0x1111111111111111111111111111111111111111';
const deployer = '0x2222222222222222222222222222222222222222';
const third = '0x3333333333333333333333333333333333333333';
const pair = '0x4444444444444444444444444444444444444444';
const pool = '0x5555555555555555555555555555555555555555';
const tx = `0x${'ab'.repeat(32)}` as const;
const factories = getPonsFactoryDeployments();
const fastRetry = { attempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitterMs: 0, sleep: async () => {}, random: () => 0, onRetry: () => {} };

function encodedLog(factoryId: string): PonsRpcLog {
  const factory = factories.find(item => item.id === factoryId)!;
  const event = parseAbiItem(factory.tokenLaunchedEvent);
  if (factory.generation === 'v1') return {
    topics: encodeEventTopics({ abi: [event], eventName: 'TokenLaunched', args: { token, deployer, dexFactory: third } }) as readonly `0x${string}`[],
    data: encodeAbiParameters(parseAbiParameters('address,address,uint256,uint256,uint256,uint256,uint256'), [pair, pool, 1n, 2n, 3n, 4n, 5n]),
    blockNumber: 10n, transactionHash: tx, logIndex: 7,
  };
  return {
    topics: encodeEventTopics({ abi: [event], eventName: 'TokenLaunched', args: { token, curve: third, deployer } }) as readonly `0x${string}`[],
    data: encodeAbiParameters(parseAbiParameters('address,uint256,uint256'), [pair, 6n, 7n]),
    blockNumber: 11n, transactionHash: tx, logIndex: 8,
  };
}

test('decodes and normalizes V1 TokenLaunched', () => {
  const row = decodePonsLaunch(factories[0], encodedLog('v1-legacy'), 1_700_000_000n)!;
  assert.equal(row.token_address, token); assert.equal(row.deployer_address, deployer);
  assert.equal(row.pool_address, pool); assert.equal(row.curve_address, null);
  assert.equal(row.launch_config_id, '2'); assert.equal(row.initial_buy_amount, '5');
  assert.equal(row.factory_address, factories[0].address.toLowerCase());
});

test('decodes and normalizes V2 TokenLaunched without inventing V1 fields', () => {
  const factory = factories.find(item => item.id === 'v2-current')!;
  const row = decodePonsLaunch(factory, encodedLog('v2-current'), 1_700_000_000n)!;
  assert.equal(row.token_address, token); assert.equal(row.deployer_address, deployer);
  assert.equal(row.curve_address, third); assert.equal(row.pair_token_address, pair);
  assert.equal(row.launch_config_id, '6'); assert.equal(row.graduation_threshold, '7');
  assert.equal(row.pool_address, null); assert.equal(row.initial_buy_amount, null);
});

test('registry includes both verified V2 emitters at first observed launch blocks', () => {
  const oldV2 = factories.find(item => item.id === 'v2-old')!;
  const currentV2 = factories.find(item => item.id === 'v2-current')!;
  assert.equal(oldV2.address.toLowerCase(), '0x7e1eabd52ae29598e6483f72dcf1a70b14284db8');
  assert.equal(oldV2.startBlock, 24_364_906n); assert.equal(oldV2.endBlock, undefined);
  assert.equal(currentV2.address.toLowerCase(), '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e');
  assert.equal(currentV2.startBlock, 27_027_321n);
});

test('event identity is stable across EVM address and transaction hash casing', () => {
  const base = { chain: 'robinhood' as const, factory_address: factories[0].address, transaction_hash: tx, log_index: 7 };
  assert.equal(launchIdentity(base), launchIdentity({ ...base, factory_address: base.factory_address.toUpperCase(), transaction_hash: tx.toUpperCase() }));
});

test('chunk boundaries are inclusive, contiguous, and bounded', () => {
  assert.deepEqual(buildChunkBoundaries(10n, 20n, 4n), [[10n, 13n], [14n, 17n], [18n, 20n]]);
});

test('scanner reduces rejected ranges, deduplicates events, caches block timestamps, and persists before checkpoint progress', async () => {
  let blockReads = 0; const writes: bigint[] = []; let calls = 0;
  const rpc = { getBlockNumber: async () => 13n, getBlock: async () => { blockReads += 1; return { timestamp: 1_700_000_000n }; },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls += 1; if (toBlock - fromBlock + 1n > 2n) throw new Error('block range limit exceeded');
      return fromBlock === 10n ? [encodedLog('v1-legacy'), encodedLog('v1-legacy')] : [];
    } };
  const storage = { getCheckpoint: async () => null, persistChunk: async (_factory: unknown, _rows: unknown[], through: bigint) => { writes.push(through); } };
  const result = await scanPonsLaunches(rpc as never, storage, { factory: 'v1-legacy', fromBlock: 10n, toBlock: 13n, chunkSize: 4n, minChunkSize: 1n });
  assert.equal(result.retriedChunks, 1); assert.equal(result.duplicateEvents, 1); assert.equal(result.launches.length, 1);
  assert.equal(blockReads, 1); assert.deepEqual(writes, [11n, 13n]); assert.ok(calls >= 3);
});

test('scanner grows successful sparse chunks up to the configured maximum', async () => {
  const ranges: bigint[] = [];
  const rpc = { getBlockNumber: async () => 20n, getBlock: async () => ({ timestamp: 1n }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { ranges.push(toBlock - fromBlock + 1n); return []; } };
  const storage = { getCheckpoint: async () => null, persistChunk: async () => {} };
  await scanPonsLaunches(rpc as never, storage, { factory: 'v1-legacy', fromBlock: 1n, toBlock: 20n, chunkSize: 2n, minChunkSize: 1n, maxChunkSize: 8n });
  assert.deepEqual(ranges, [2n, 4n, 8n, 6n]);
});

test('scanner resumes immediately after the persisted per-factory checkpoint', async () => {
  const ranges: Array<[bigint, bigint]> = [];
  const rpc = { getBlockNumber: async () => 15n, getBlock: async () => ({ timestamp: 1n }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { ranges.push([fromBlock, toBlock]); return []; } };
  const storage = { getCheckpoint: async (factoryId: string) => factoryId === 'v2-old' ? 12n : null, persistChunk: async () => {} };
  await scanPonsLaunches(rpc as never, storage, { factory: 'v2-old', toBlock: 15n, chunkSize: 10n });
  assert.deepEqual(ranges, [[13n, 15n]]);
});

test('transient getBlock failure retries and succeeds without duplicating persistence', async () => {
  let blockAttempts = 0; let persisted = 0;
  const rpc = { getBlockNumber: async () => 10n, getLogs: async () => [encodedLog('v1-legacy')],
    getBlock: async () => { blockAttempts += 1; if (blockAttempts === 1) throw new Error('RPC -32000 upstream internal node connection refused'); return { timestamp: 1_700_000_000n }; } };
  const storage = { getCheckpoint: async () => null, persistChunk: async () => { persisted += 1; } };
  const result = await scanPonsLaunches(rpc as never, storage, { factory: 'v1-legacy', fromBlock: 10n, toBlock: 10n, retry: fastRetry });
  assert.equal(blockAttempts, 2); assert.equal(persisted, 1); assert.equal(result.launches.length, 1);
});

test('transient getLogs failure retries the same range before adaptive shrinking', async () => {
  const ranges: Array<[bigint, bigint]> = [];
  const rpc = { getBlockNumber: async () => 2n, getBlock: async () => ({ timestamp: 1n }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]); if (ranges.length === 1) throw new TypeError('fetch failed'); return [];
    } };
  const storage = { getCheckpoint: async () => null, persistChunk: async () => {} };
  const result = await scanPonsLaunches(rpc as never, storage, { factory: 'v1-legacy', fromBlock: 1n, toBlock: 2n, chunkSize: 2n, retry: fastRetry });
  assert.deepEqual(ranges, [[1n, 2n], [1n, 2n]]); assert.equal(result.retriedChunks, 0);
});

test('transient launch persistence retries before a single checkpoint advance', async () => {
  let launchAttempts = 0; const checkpoints: bigint[] = [];
  const storage = createPonsLaunchStorage({ readCheckpoint: async () => null,
    upsertLaunches: async () => { launchAttempts += 1; if (launchAttempts < 3) throw new TypeError('fetch failed'); },
    upsertCheckpoint: async (_factory, throughBlock) => { checkpoints.push(throughBlock); } }, fastRetry);
  await storage.persistChunk(factories[0], [decodePonsLaunch(factories[0], encodedLog('v1-legacy'), 1_700_000_000n)!], 10n);
  assert.equal(launchAttempts, 3); assert.deepEqual(checkpoints, [10n]);
});

test('transient checkpoint persistence retries without repeating successful launch persistence', async () => {
  let launchAttempts = 0; let checkpointAttempts = 0;
  const storage = createPonsLaunchStorage({ readCheckpoint: async () => null,
    upsertLaunches: async () => { launchAttempts += 1; },
    upsertCheckpoint: async () => { checkpointAttempts += 1; if (checkpointAttempts < 3) throw new TypeError('fetch failed'); } }, fastRetry);
  await storage.persistChunk(factories[0], [decodePonsLaunch(factories[0], encodedLog('v1-legacy'), 1_700_000_000n)!], 10n);
  assert.equal(launchAttempts, 1); assert.equal(checkpointAttempts, 3);
});

test('non-transient storage failure throws clearly and never advances checkpoint', async () => {
  let launchAttempts = 0; let checkpointAttempts = 0;
  const storage = createPonsLaunchStorage({ readCheckpoint: async () => null,
    upsertLaunches: async () => { launchAttempts += 1; throw new Error('column protocol_version does not exist'); },
    upsertCheckpoint: async () => { checkpointAttempts += 1; } }, fastRetry);
  await assert.rejects(storage.persistChunk(factories[0], [decodePonsLaunch(factories[0], encodedLog('v1-legacy'), 1_700_000_000n)!], 10n), /does not exist/);
  assert.equal(launchAttempts, 1); assert.equal(checkpointAttempts, 0);
});

test('failed persistence does not report or attempt a later checkpoint', async () => {
  let writes = 0;
  const rpc = { getBlockNumber: async () => 2n, getBlock: async () => ({ timestamp: 1n }), getLogs: async () => [] };
  const storage = { getCheckpoint: async () => null, persistChunk: async () => { writes += 1; throw new Error('database failed'); } };
  await assert.rejects(scanPonsLaunches(rpc as never, storage, { factory: 'v1-legacy', fromBlock: 1n, toBlock: 2n }), /database failed/);
  assert.equal(writes, 1);
});

test('dry run performs no launch or checkpoint writes', async () => {
  let writes = 0;
  const rpc = { getBlockNumber: async () => 1n, getBlock: async () => ({ timestamp: 1n }), getLogs: async () => [] };
  const storage = { getCheckpoint: async () => null, persistChunk: async () => { writes += 1; } };
  await scanPonsLaunches(rpc as never, storage, { factory: 'v1-legacy', fromBlock: 1n, toBlock: 1n, dryRun: true });
  assert.equal(writes, 0);
});

test('developer report aggregates launches and version counts without quality labels', () => {
  const rows = aggregatePonsDevelopers([
    { deployer_address: deployer.toUpperCase(), protocol_version: 'v1-active', block_timestamp: '2026-01-02T00:00:00Z' },
    { deployer_address: deployer, protocol_version: 'v2-current', block_timestamp: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(rows[0].developer, deployer); assert.equal(rows[0].totalLaunches, 2);
  assert.equal(rows[0].firstLaunch, '2026-01-01T00:00:00Z'); assert.deepEqual(rows[0].countsByVersion, { 'v1-active': 1, 'v2-current': 1 });
});
