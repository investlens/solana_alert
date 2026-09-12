import {
  createPublicClient,
  http,
  type Hex,
} from 'viem';

import {
  robinhoodChain,
} from './config.js';

const rawRobinhoodPublicClient =
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

type RobinhoodReceipt = Awaited<ReturnType<typeof rawRobinhoodPublicClient.getTransactionReceipt>>;
type RobinhoodReceiptWithTopics = Omit<RobinhoodReceipt, 'logs'> & {
  logs: Array<RobinhoodReceipt['logs'][number] & {
    topics: [Hex, ...Hex[]];
  }>;
};

type RobinhoodPublicClient = Omit<typeof rawRobinhoodPublicClient, 'getTransactionReceipt'> & {
  getTransactionReceipt(
    args: Parameters<typeof rawRobinhoodPublicClient.getTransactionReceipt>[0],
  ): Promise<RobinhoodReceiptWithTopics>;
};

// The RPC always returns log topics. Viem's generic receipt type can omit them when
// no event ABI is attached to the receipt request, so we preserve the runtime client
// while exposing the actual receipt shape used by AlphaOS receipt decoding.
export const robinhoodPublicClient =
  rawRobinhoodPublicClient as RobinhoodPublicClient;

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
    robinhoodPublicClient.getBlockNumber(),
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
