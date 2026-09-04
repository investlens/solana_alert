import { decodeEventLog, parseAbiItem, type Hex } from 'viem';
import { getPonsFactoryDeployments, type PonsFactoryDeployment } from './ponsContracts.js';

export type PonsLaunch = {
  chain: 'robinhood'; protocol: 'pons'; protocol_version: string; factory_address: string;
  token_address: string; deployer_address: string; curve_address: string | null;
  pool_address: string | null; pair_token_address: string | null; launch_config_id: string | null;
  graduation_threshold: string | null; initial_buy_amount: string | null; block_number: string;
  block_timestamp: string; transaction_hash: string; log_index: number;
};

export type PonsRpcLog = { data: Hex; topics: readonly Hex[]; blockNumber: bigint | null; transactionHash: Hex | null; logIndex: number | null };
export type PonsScannerRpc = {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: { address: `0x${string}`; event: ReturnType<typeof parseAbiItem>; fromBlock: bigint; toBlock: bigint }): Promise<readonly PonsRpcLog[]>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};
export type PonsScannerStorage = {
  getCheckpoint(factoryId: string): Promise<bigint | null>;
  persistChunk(factory: PonsFactoryDeployment, launches: PonsLaunch[], throughBlock: bigint): Promise<void>;
};
export type PonsRetryOptions = {
  attempts?: number; baseDelayMs?: number; maxDelayMs?: number; jitterMs?: number;
  sleep?: (delayMs: number) => Promise<void>; random?: () => number; onRetry?: (message: string) => void;
};
export type ScanOptions = { factory?: string; fromBlock?: bigint; toBlock?: bigint; chunkSize?: bigint; minChunkSize?: bigint; maxChunkSize?: bigint; limitChunks?: number; dryRun?: boolean; retry?: PonsRetryOptions };
export type ScanSummary = { launches: PonsLaunch[]; duplicateEvents: number; chunks: number; retriedChunks: number; countsByFactory: Record<string, number>; checkpoints: Record<string, string> };

export const normalizeEvmAddress = (value: string) => value.toLowerCase();
export const launchIdentity = (launch: Pick<PonsLaunch, 'chain' | 'factory_address' | 'transaction_hash' | 'log_index'>) =>
  `${launch.chain.toLowerCase()}:${normalizeEvmAddress(launch.factory_address)}:${launch.transaction_hash.toLowerCase()}:${launch.log_index}`;

export function buildChunkBoundaries(from: bigint, to: bigint, size: bigint): Array<[bigint, bigint]> {
  if (size <= 0n) throw new Error('chunk size must be positive');
  const chunks: Array<[bigint, bigint]> = [];
  for (let start = from; start <= to; start += size) chunks.push([start, start + size - 1n > to ? to : start + size - 1n]);
  return chunks;
}

export function concisePonsError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'unknown error';
}

export function isTransientPonsError(error: unknown): boolean {
  const reason = concisePonsError(error).toLowerCase();
  return /fetch failed|network|socket|econn|connection (?:refused|reset)|timed? ?out|i\/o timeout|cloudflare|forbidden|http(?: status)?\s*(?:403|408|429|5\d\d)|status(?: code)?[:= ]+(?:403|408|429|5\d\d)|\b(?:408|429|5\d\d)\b/.test(reason)
    || (reason.includes('-32000') && /upstream|internal node|connect|refused|timeout/.test(reason));
}

export async function retryPonsOperation<T>(operation: string, run: () => Promise<T>, options: PonsRetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const jitterMs = options.jitterMs ?? 250;
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;
  const log = options.onRetry ?? console.log;
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('retry attempts must be a positive integer');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await run(); }
    catch (error) {
      if (!isTransientPonsError(error) || attempt === attempts) throw error;
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const delayMs = Math.min(maxDelayMs, Math.round(exponential + random() * jitterMs));
      log(`[PonsBackfill] retry operation=${operation} attempt=${attempt + 1}/${attempts} delayMs=${delayMs} reason=${concisePonsError(error)}`);
      await sleep(delayMs);
    }
  }
  throw new Error(`retry operation exhausted: ${operation}`);
}

export function decodePonsLaunch(factory: PonsFactoryDeployment, log: PonsRpcLog, timestamp: bigint): PonsLaunch | null {
  if (log.blockNumber == null || !log.transactionHash || log.logIndex == null) return null;
  const decoded = decodeEventLog({ abi: [parseAbiItem(factory.tokenLaunchedEvent)], data: log.data, topics: log.topics as [Hex, ...Hex[]] }) as unknown as { args: Record<string, unknown> };
  const args = decoded.args;
  if (!args.token || !args.deployer) return null;
  const text = (name: string) => args[name] == null ? null : String(args[name]);
  const address = (name: string) => args[name] == null ? null : normalizeEvmAddress(String(args[name]));
  return {
    chain: 'robinhood', protocol: 'pons', protocol_version: factory.id,
    factory_address: normalizeEvmAddress(factory.address), token_address: address('token')!, deployer_address: address('deployer')!,
    curve_address: address('curve'), pool_address: address('pool'), pair_token_address: address('pairToken'),
    launch_config_id: text('launchConfigId'), graduation_threshold: text('graduationThreshold'), initial_buy_amount: text('initialBuyAmount'),
    block_number: log.blockNumber.toString(), block_timestamp: new Date(Number(timestamp) * 1000).toISOString(),
    transaction_hash: log.transactionHash.toLowerCase(), log_index: log.logIndex,
  };
}

function isReducibleRpcError(error: unknown) {
  return /range|limit|too many|timeout|timed out|response size|429|rate/i.test(concisePonsError(error));
}

export async function scanPonsLaunches(rpc: PonsScannerRpc, storage: PonsScannerStorage, options: ScanOptions = {},
  onProgress?: (line: string) => void): Promise<ScanSummary> {
  const factories = getPonsFactoryDeployments().filter(item => item.enabled && (!options.factory || options.factory === 'all' || item.id === options.factory));
  if (!factories.length) throw new Error(`Unknown Pons factory: ${options.factory}`);
  const retry = { ...options.retry, onRetry: options.retry?.onRetry ?? onProgress ?? console.log };
  const head = options.toBlock ?? await retryPonsOperation('getBlockNumber', () => rpc.getBlockNumber(), retry);
  const summary: ScanSummary = { launches: [], duplicateEvents: 0, chunks: 0, retriedChunks: 0, countsByFactory: {}, checkpoints: {} };
  const seen = new Set<string>();
  const timestampCache = new Map<bigint, string>();
  const baseSize = options.chunkSize ?? 2_500n;
  const maximum = options.maxChunkSize ?? 20_000n;
  const minimum = options.minChunkSize ?? (maximum < 25n ? maximum : 25n);
  if (baseSize <= 0n || minimum <= 0n || maximum <= 0n) throw new Error('chunk sizes must be positive');
  if (minimum > maximum) throw new Error('minimum chunk size cannot exceed maximum chunk size');

  for (const factory of factories) {
    const checkpoint = options.fromBlock == null ? await storage.getCheckpoint(factory.id) : null;
    const from = options.fromBlock ?? (checkpoint != null ? checkpoint + 1n : factory.startBlock);
    if (from == null) throw new Error(`Start block for ${factory.id} is not configured; pass --from-block`);
    const target = factory.endBlock != null && factory.endBlock < head ? factory.endBlock : head;
    if (from > target) continue;
    let cursor = from;
    let chunkSize = baseSize > maximum ? maximum : baseSize;
    while (cursor <= target && (options.limitChunks == null || summary.chunks < options.limitChunks)) {
      const to = cursor + chunkSize - 1n > target ? target : cursor + chunkSize - 1n;
      let logs: readonly PonsRpcLog[];
      try {
        logs = await retryPonsOperation('getLogs', () => rpc.getLogs({ address: factory.address, event: parseAbiItem(factory.tokenLaunchedEvent), fromBlock: cursor, toBlock: to }), retry);
      } catch (error) {
        if (isReducibleRpcError(error) && chunkSize > minimum) {
          chunkSize = chunkSize / 2n < minimum ? minimum : chunkSize / 2n;
          summary.retriedChunks += 1;
          continue;
        }
        throw error;
      }
      const decoded: PonsLaunch[] = [];
      for (const log of logs) {
        if (log.blockNumber == null) continue;
        let timestamp = timestampCache.get(log.blockNumber);
        if (!timestamp) {
          const block = await retryPonsOperation('getBlock', () => rpc.getBlock({ blockNumber: log.blockNumber! }), retry);
          timestamp = new Date(Number(block.timestamp) * 1000).toISOString();
          timestampCache.set(log.blockNumber, timestamp);
        }
        const launch = decodePonsLaunch(factory, log, BigInt(Math.floor(Date.parse(timestamp) / 1000)));
        if (!launch) continue;
        const identity = launchIdentity(launch);
        if (seen.has(identity)) { summary.duplicateEvents += 1; continue; }
        seen.add(identity); decoded.push(launch); summary.launches.push(launch);
      }
      if (!options.dryRun) await storage.persistChunk(factory, decoded, to);
      summary.chunks += 1;
      summary.countsByFactory[factory.id] = (summary.countsByFactory[factory.id] ?? 0) + decoded.length;
      summary.checkpoints[factory.id] = to.toString();
      onProgress?.(`[PonsBackfill] factory=${factory.id} blocks=${cursor}-${to} chunkSize=${chunkSize} logs=${logs.length}`);
      cursor = to + 1n;
      if (logs.length <= 10 && chunkSize < maximum) chunkSize = chunkSize * 2n > maximum ? maximum : chunkSize * 2n;
    }
  }
  return summary;
}
