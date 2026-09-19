import {
  createPublicClient,
  http,
} from 'viem';

import {
  robinhoodChain,
} from './config.js';

const OFFICIAL_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const PUBLICNODE_RPC = 'https://robinhood-rpc.publicnode.com';
const LOG_REPLAY_CHUNK_BLOCKS = BigInt(Math.max(5, Number(process.env.ROBINHOOD_LOG_REPLAY_CHUNK_BLOCKS ?? 25)));
const RPC_COOLDOWN_MS = Math.max(15_000, Number(process.env.ROBINHOOD_RPC_COOLDOWN_MS ?? 60_000));
const RPC_FAILURE_THRESHOLD = Math.max(1, Number(process.env.ROBINHOOD_RPC_FAILURE_THRESHOLD ?? 2));
const RPC_BUSY_WAIT_MS = Math.max(10, Number(process.env.ROBINHOOD_RPC_BUSY_WAIT_MS ?? 25));

export const robinhoodPublicClient =
  createPublicClient({
    chain: robinhoodChain,

    transport: http(
      robinhoodChain.rpcUrls
        .default.http[0],
      {
        timeout: 10_000,
        retryCount: 2,
        retryDelay: 500,
      },
    ),
  });

const robinhoodArchiveRpcUrl = String(
  process.env.ROBINHOOD_ARCHIVE_RPC_URL
    ?? 'https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public',
).trim();

export const robinhoodArchiveClient =
  createPublicClient({
    chain: robinhoodChain,

    transport: http(
      robinhoodArchiveRpcUrl,
      {
        timeout: 12_000,
        retryCount: 2,
        retryDelay: 500,
      },
    ),
  });

const robinhoodRpcUrls = [...new Set([
  String(process.env.ROBINHOOD_RPC_URL ?? '').trim(),
  robinhoodArchiveRpcUrl,
  OFFICIAL_RPC,
  String(process.env.ROBINHOOD_RPC_FALLBACK_URL ?? '').trim(),
  PUBLICNODE_RPC,
].filter(Boolean))];

const robinhoodRpcClients = robinhoodRpcUrls.map(url => ({
  url,
  client: createPublicClient({
    chain: robinhoodChain,
    transport: http(url, {
      timeout: 10_000,
      retryCount: 1,
      retryDelay: 350,
    }),
  }),
}));

type RpcProviderHealth = { failures: number; cooldownUntil: number; inFlight: number };
const rpcProviderHealth = new Map<string, RpcProviderHealth>();
const RPC_BLOCK_NUMBER_CACHE_MS = Math.max(250, Number(process.env.ROBINHOOD_BLOCK_NUMBER_CACHE_MS ?? 1_000));
let blockNumberCache: { value: bigint; expiresAt: number } | null = null;
let blockNumberInFlight: Promise<bigint> | null = null;
const rpcRequestCache = new Map<string, { value: unknown; expiresAt: number }>();
const rpcRequestInflight = new Map<string, Promise<unknown>>();
const RPC_STATIC_CACHE_MS = Math.max(1_000, Number(process.env.ROBINHOOD_RPC_STATIC_CACHE_MS ?? 30_000));

function stableRpcKey(args: any): string {
  try { return JSON.stringify(args, (_key, value) => typeof value === 'bigint' ? value.toString() : value); }
  catch { return ''; }
}

function cacheableRpcMethod(method: string): boolean {
  return ['eth_chainId', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getCode'].includes(method);
}

function conciseRpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 220);
}

function providerHealth(url: string): RpcProviderHealth {
  const existing = rpcProviderHealth.get(url);
  if (existing) return existing;
  const created = { failures: 0, cooldownUntil: 0, inFlight: 0 };
  rpcProviderHealth.set(url, created);
  return created;
}

function markProviderSuccess(url: string): void {
  const health = providerHealth(url);
  if (health.failures || health.cooldownUntil) console.info('[RobinhoodRpc] provider recovered', { provider: url });
  health.failures = 0;
  health.cooldownUntil = 0;
}

function markProviderFailure(url: string): void {
  const health = providerHealth(url);
  health.failures += 1;
  if (health.failures >= RPC_FAILURE_THRESHOLD) {
    health.cooldownUntil = Math.max(health.cooldownUntil, Date.now() + RPC_COOLDOWN_MS);
    console.warn('[RobinhoodRpc] provider circuit opened', { provider: url, failures: health.failures, cooldownMs: RPC_COOLDOWN_MS });
  }
}

async function runProvider<T>(
  url: string,
  client: (typeof robinhoodRpcClients)[number]['client'],
  run: (client: (typeof robinhoodRpcClients)[number]['client']) => Promise<T>,
): Promise<T> {
  const health = providerHealth(url);
  health.inFlight += 1;
  try {
    const result = await run(client);
    markProviderSuccess(url);
    return result;
  } catch (error) {
    markProviderFailure(url);
    throw error;
  } finally {
    health.inFlight = Math.max(0, health.inFlight - 1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRobinhoodRpcFailover<T>(
  operation: string,
  run: (client: (typeof robinhoodRpcClients)[number]['client']) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;

  // A provider gets at most one request at a time. Concurrent PONS work therefore
  // fans out across healthy fallbacks instead of stampeding the same endpoint.
  // As soon as a request opens a circuit, all later calls observe the shared
  // cooldown immediately. No scoring, launch routing or alert semantics change.
  for (let pass = 0; pass < 2; pass += 1) {
    const now = Date.now();
    let eligible = 0;
    let busy = 0;

    for (const { url, client } of robinhoodRpcClients) {
      const health = providerHealth(url);
      if (health.cooldownUntil > now) continue;
      eligible += 1;
      if (health.inFlight > 0) {
        busy += 1;
        continue;
      }

      try {
        return await runProvider(url, client, run);
      } catch (error) {
        lastError = error;
        console.warn(`[RobinhoodRpc] ${operation} provider failed; trying next provider`, {
          provider: url,
          reason: conciseRpcError(error),
        });
      }
    }

    // If every healthy provider is already serving another live request, wait a
    // tiny bounded interval and re-evaluate shared health instead of forcing a
    // concurrent request through a rate-limited provider.
    if (eligible > 0 && busy === eligible && pass === 0) {
      await sleep(RPC_BUSY_WAIT_MS);
      continue;
    }
    break;
  }

  // Only probe a cooled provider when there is no healthy provider available.
  // Never probe one that is already in flight; that would recreate the stampede.
  const now = Date.now();
  const probe = [...robinhoodRpcClients]
    .filter(({ url }) => providerHealth(url).inFlight === 0)
    .sort((a, b) => providerHealth(a.url).cooldownUntil - providerHealth(b.url).cooldownUntil)[0];

  if (probe && robinhoodRpcClients.every(({ url }) => providerHealth(url).cooldownUntil > now)) {
    try {
      return await runProvider(probe.url, probe.client, run);
    } catch (error) {
      lastError = error;
      console.warn(`[RobinhoodRpc] ${operation} cooldown probe failed`, {
        provider: probe.url,
        reason: conciseRpcError(error),
      });
    }
  }

  throw lastError ?? new Error(`No healthy Robinhood RPC provider available for ${operation}`);
}

async function getLogsFromProviders(args: any, operation = 'getLogs'): Promise<any[]> {
  return withRobinhoodRpcFailover(operation, async client => await client.getLogs(args as any) as any[]);
}

function canChunkLogRange(args: any): args is { fromBlock: bigint; toBlock: bigint } & Record<string, unknown> {
  return typeof args?.fromBlock === 'bigint' && typeof args?.toBlock === 'bigint' && args.toBlock >= args.fromBlock;
}

function logIdentity(log: any): string {
  return `${String(log?.transactionHash ?? '')}:${String(log?.logIndex ?? '')}:${String(log?.blockNumber ?? '')}:${String(log?.address ?? '')}`;
}

export async function getRobinhoodLogsResilient(args: any): Promise<any[]> {
  try {
    return await getLogsFromProviders(args);
  } catch (initialError) {
    if (!canChunkLogRange(args)) throw initialError;
    const blockCount = args.toBlock - args.fromBlock + 1n;
    if (blockCount <= LOG_REPLAY_CHUNK_BLOCKS) throw initialError;
    console.warn('[RobinhoodRpc] full getLogs range failed; replaying in chunks', {
      fromBlock: args.fromBlock.toString(), toBlock: args.toBlock.toString(), blockCount: blockCount.toString(), chunkBlocks: LOG_REPLAY_CHUNK_BLOCKS.toString(),
    });
    const collected: any[] = [];
    for (let fromBlock = args.fromBlock; fromBlock <= args.toBlock; fromBlock += LOG_REPLAY_CHUNK_BLOCKS) {
      const toBlock = fromBlock + LOG_REPLAY_CHUNK_BLOCKS - 1n < args.toBlock ? fromBlock + LOG_REPLAY_CHUNK_BLOCKS - 1n : args.toBlock;
      const chunk = await getLogsFromProviders({ ...args, fromBlock, toBlock }, 'getLogsChunk');
      collected.push(...chunk);
    }
    const deduped = new Map<string, any>();
    for (const log of collected) deduped.set(logIdentity(log), log);
    return [...deduped.values()].sort((left, right) => {
      const blockDelta = Number((left?.blockNumber ?? 0n) - (right?.blockNumber ?? 0n));
      if (blockDelta !== 0) return blockDelta;
      return Number((left?.logIndex ?? 0) - (right?.logIndex ?? 0));
    });
  }
}

export async function getRobinhoodBlockNumberResilient(): Promise<bigint> {
  const now = Date.now();
  if (blockNumberCache && blockNumberCache.expiresAt > now) return blockNumberCache.value;
  if (blockNumberInFlight) return blockNumberInFlight;
  blockNumberInFlight = withRobinhoodRpcFailover('blockNumber', client => client.getBlockNumber());
  try {
    const value = await blockNumberInFlight;
    blockNumberCache = { value, expiresAt: Date.now() + RPC_BLOCK_NUMBER_CACHE_MS };
    return value;
  } finally {
    blockNumberInFlight = null;
  }
}

export async function getRobinhoodBlockResilient(args: any): Promise<any> {
  return withRobinhoodRpcFailover('getBlock', client => client.getBlock(args as any));
}

export async function requestRobinhoodRpcResilient(args: any): Promise<any> {
  const method = String(args?.method ?? 'rpcRequest');
  if (!cacheableRpcMethod(method)) return withRobinhoodRpcFailover(method, client => (client as any).request(args));

  const key = stableRpcKey(args);
  const cached = key ? rpcRequestCache.get(key) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = key ? rpcRequestInflight.get(key) : null;
  if (existing) return existing;

  const request = withRobinhoodRpcFailover(method, client => (client as any).request(args));
  if (key) rpcRequestInflight.set(key, request);
  try {
    const value = await request;
    if (key) {
      rpcRequestCache.set(key, { value, expiresAt: Date.now() + RPC_STATIC_CACHE_MS });
      if (rpcRequestCache.size > 5_000) {
        const now = Date.now();
        for (const [candidate, entry] of rpcRequestCache) if (entry.expiresAt <= now) rpcRequestCache.delete(candidate);
      }
    }
    return value;
  } finally {
    if (key) rpcRequestInflight.delete(key);
  }
}

export const robinhoodResilientScannerRpc = {
  getBlockNumber: getRobinhoodBlockNumberResilient,
  getLogs: getRobinhoodLogsResilient,
  getBlock: getRobinhoodBlockResilient,
};

export async function testRobinhoodRpc(): Promise<{ chainId: number; blockNumber: bigint }> {
  const [chainId, blockNumber] = await Promise.all([robinhoodPublicClient.getChainId(), getRobinhoodBlockNumberResilient()]);
  if (chainId !== 4663) throw new Error(`Unexpected Robinhood Chain ID: ${chainId}`);
  return { chainId, blockNumber };
}
