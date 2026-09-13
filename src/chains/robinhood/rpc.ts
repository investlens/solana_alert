import {
  createPublicClient,
  fallback,
  http,
} from 'viem';

import {
  robinhoodChain,
} from './config.js';

const publicRpcUrl =
  robinhoodChain.rpcUrls
    .default.http[0];

/*
 * Robinhood's public RPC is intentionally retained as the safe default,
 * so existing production behaviour does not change unless a dedicated
 * provider URL is configured.
 *
 * When ROBINHOOD_RPC_URL is present, AlphaOS prefers that production RPC
 * and keeps Robinhood's public RPC as a fallback instead of allowing a
 * single provider outage/rate-limit event to stop wallet monitoring.
 */
const configuredRpcUrl =
  process.env.ROBINHOOD_RPC_URL?.trim() ||
  null;

function rpcTransport(url: string) {
  return http(
    url,
    {
      timeout: 10_000,
      retryCount: 2,
      retryDelay: 500,
    },
  );
}

const transport =
  configuredRpcUrl &&
  configuredRpcUrl !== publicRpcUrl
    ? fallback([
        rpcTransport(configuredRpcUrl),
        rpcTransport(publicRpcUrl),
      ])
    : rpcTransport(publicRpcUrl);

export const robinhoodPublicClient =
  createPublicClient({
    chain: robinhoodChain,
    transport,
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
