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
  OFFICIAL_RPC,
  String(process.env.ROBINHOOD_RPC_URL ?? '').trim(),
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

function conciseRpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 220);
}

async function withRobinhoodRpcFailover<T>(
  operation: string,
  run: (client: (typeof robinhoodRpcClients)[number]['client']) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (const { url, client } of robinhoodRpcClients) {
    try {
      return await run(client);
    } catch (error) {
      lastError = error;
      console.warn(`[RobinhoodRpc] ${operation} provider failed; trying next provider`, {
        provider: url,
        reason: conciseRpcError(error),
      });
    }
  }
  throw lastError ?? new Error(`No Robinhood RPC provider available for ${operation}`);
}

async function getLogsFromProviders(args: any, operation = 'getLogs'): Promise<any[]> {
  return withRobinhoodRpcFailover(operation, async client =>
    await client.getLogs(args as any) as any[]);
}

function canChunkLogRange(args: any): args is { fromBlock: bigint; toBlock: bigint } & Record<string, unknown> {
  return typeof args?.fromBlock === 'bigint'
    && typeof args?.toBlock === 'bigint'
    && args.toBlock >= args.fromBlock;
}

function logIdentity(log: any): string {
  return `${String(log?.transactionHash ?? '')}:${String(log?.logIndex ?? '')}:${String(log?.blockNumber ?? '')}:${String(log?.address ?? '')}`;
}

/**
 * Log scanning is the most failure-prone Robinhood RPC workload. First try the
 * complete requested range across all configured providers. If every provider
 * rejects a multi-block range, replay that exact range in small non-overlapping
 * chunks. Checkpoints are still advanced only by the caller after all chunks
 * succeed, so partial recovery can never silently skip launches.
 */
export async function getRobinhoodLogsResilient(args: any): Promise<any[]> {
  try {
    return await getLogsFromProviders(args);
  } catch (initialError) {
    if (!canChunkLogRange(args)) throw initialError;
    const blockCount = args.toBlock - args.fromBlock + 1n;
    if (blockCount <= LOG_REPLAY_CHUNK_BLOCKS) throw initialError;

    console.warn('[RobinhoodRpc] full getLogs range failed; replaying in chunks', {
      fromBlock: args.fromBlock.toString(),
      toBlock: args.toBlock.toString(),
      blockCount: blockCount.toString(),
      chunkBlocks: LOG_REPLAY_CHUNK_BLOCKS.toString(),
    });

    const collected: any[] = [];
    for (let fromBlock = args.fromBlock; fromBlock <= args.toBlock; fromBlock += LOG_REPLAY_CHUNK_BLOCKS) {
      const toBlock = fromBlock + LOG_REPLAY_CHUNK_BLOCKS - 1n < args.toBlock
        ? fromBlock + LOG_REPLAY_CHUNK_BLOCKS - 1n
        : args.toBlock;
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
  return withRobinhoodRpcFailover('blockNumber', client => client.getBlockNumber());
}

export async function getRobinhoodBlockResilient(args: any): Promise<any> {
  return withRobinhoodRpcFailover('getBlock', client => client.getBlock(args as any));
}

export const robinhoodResilientScannerRpc = {
  getBlockNumber: getRobinhoodBlockNumberResilient,
  getLogs: getRobinhoodLogsResilient,
  getBlock: getRobinhoodBlockResilient,
};

export async function testRobinhoodRpc():
  Promise<{
    chainId: number;
    blockNumber: bigint;
  }> {
  const [
    chainId,
    blockNumber,
  ] = await Promise.all([
    robinhoodPublicClient.getChainId(),
    getRobinhoodBlockNumberResilient(),
  ]);

  if (chainId !== 4663) {
    throw new Error(
      `Unexpected Robinhood Chain ID: ${chainId}`,
    );
  }

  return {
    chainId,
    blockNumber,
  };
}
