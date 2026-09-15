import {
  createPublicClient,
  http,
} from 'viem';

import {
  robinhoodChain,
} from './config.js';

const OFFICIAL_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const PUBLICNODE_RPC = 'https://robinhood-rpc.publicnode.com';

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

/**
 * Log scanning is the most failure-prone Robinhood RPC workload. The official
 * endpoint can fail transiently, while PublicNode may reject older ranges as
 * archive requests. Try each configured provider independently instead of
 * allowing a single endpoint outage to stop launch discovery.
 */
export async function getRobinhoodLogsResilient(args: any): Promise<any[]> {
  return withRobinhoodRpcFailover('getLogs', async client =>
    await client.getLogs(args as any) as any[]);
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
