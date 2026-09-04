import 'dotenv/config';
import { robinhoodPublicClient } from '../src/chains/robinhood/rpc.js';
import { scanPonsLaunches, type PonsScannerStorage, type ScanOptions } from '../src/chains/robinhood/ponsHistoricalLaunchScanner.js';

const values = new Map(process.argv.slice(2).map(arg => { const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2); return [key, value]; }));
const bigint = (key: string) => values.has(key) ? BigInt(values.get(key)!) : undefined;
const number = (key: string) => values.has(key) ? Number(values.get(key)) : undefined;
const options: ScanOptions = { factory: values.get('factory') ?? 'all', fromBlock: bigint('from-block'), toBlock: bigint('to-block'),
  chunkSize: bigint('chunk-size'), maxChunkSize: bigint('max-chunk-size'), limitChunks: number('limit-chunks'), dryRun: values.has('dry-run') };

const dryRunStorage: PonsScannerStorage = {
  getCheckpoint: async () => null,
  persistChunk: async () => { throw new Error('dry-run storage must never be written'); },
};
const storage = options.dryRun
  ? dryRunStorage
  : (await import('../src/chains/robinhood/ponsLaunchStorage.js')).supabasePonsLaunchStorage;
const result = await scanPonsLaunches(robinhoodPublicClient as never, storage, options, console.log);
const tokens = new Set(result.launches.map(row => row.token_address));
const deployers = new Set(result.launches.map(row => row.deployer_address));
console.log('[PonsBackfill] complete', { launchesScanned: result.launches.length, uniqueTokens: tokens.size, uniqueDeployers: deployers.size,
  countsByFactory: result.countsByFactory, duplicateEventsIgnored: result.duplicateEvents, retriedChunks: result.retriedChunks,
  checkpoints: result.checkpoints, dryRun: Boolean(options.dryRun) });
