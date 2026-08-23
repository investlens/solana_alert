import {
  createPublicClient,
  http,
} from 'viem';

import {
  robinhoodChain,
} from './config.js';

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
