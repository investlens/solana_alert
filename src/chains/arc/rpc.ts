import { createPublicClient, http } from 'viem';
import { arcChain } from './config.js';

const urls = [...new Set([
  String(process.env.ARC_RPC_URL ?? '').trim(),
  'https://rpc.mainnet.arc.io',
  String(process.env.ARC_RPC_FALLBACK_URL ?? '').trim(),
].filter(Boolean))];

const clients = urls.map(url => ({
  url,
  client: createPublicClient({
    chain: arcChain,
    transport: http(url, { timeout: 8_000, retryCount: 1, retryDelay: 250 }),
  }),
}));

const cooldownUntil = new Map<string, number>();
const COOLDOWN_MS = Math.max(15_000, Number(process.env.ARC_RPC_COOLDOWN_MS ?? 60_000));

function shortError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 180);
}

async function failover<T>(operation: string, fn: (client: typeof clients[number]['client']) => Promise<T>): Promise<T> {
  let lastError: unknown;
  const now = Date.now();
  for (const { url, client } of clients) {
    if ((cooldownUntil.get(url) ?? 0) > now) continue;
    try {
      const result = await fn(client);
      cooldownUntil.delete(url);
      return result;
    } catch (error) {
      lastError = error;
      cooldownUntil.set(url, Date.now() + COOLDOWN_MS);
      console.warn('[ArcRpc] provider failed; cooling down', { operation, provider: url, reason: shortError(error) });
    }
  }
  throw lastError ?? new Error(`No healthy Arc RPC provider available for ${operation}`);
}

export const getArcBlockNumber = () => failover('blockNumber', client => client.getBlockNumber());
export const getArcLogs = (args: any) => failover('getLogs', client => client.getLogs(args as any) as Promise<any[]>);
export const getArcBlock = (args: any) => failover('getBlock', client => client.getBlock(args as any));

export async function verifyArcMainnet(): Promise<{ chainId: number; blockNumber: bigint }> {
  return failover('verify', async client => {
    const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    if (chainId !== 5042) throw new Error(`Unexpected Arc chain id ${chainId}; expected 5042`);
    return { chainId, blockNumber };
  });
}
