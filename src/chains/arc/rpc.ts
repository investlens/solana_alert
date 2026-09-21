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

type ProviderHealth = { failures: number; cooldownUntil: number; inFlight: number };
const health = new Map<string, ProviderHealth>();
const COOLDOWN_MS = Math.max(15_000, Number(process.env.ARC_RPC_COOLDOWN_MS ?? 60_000));
const FAILURE_THRESHOLD = Math.max(1, Number(process.env.ARC_RPC_FAILURE_THRESHOLD ?? 2));
const BUSY_WAIT_MS = Math.max(10, Number(process.env.ARC_RPC_BUSY_WAIT_MS ?? 25));

const state = (url: string): ProviderHealth => {
  const current = health.get(url) ?? { failures: 0, cooldownUntil: 0, inFlight: 0 };
  health.set(url, current);
  return current;
};

function shortError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 180);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runProvider<T>(operation: string, provider: typeof clients[number], fn: (client: typeof clients[number]['client']) => Promise<T>): Promise<T> {
  const s = state(provider.url);
  s.inFlight += 1;
  try {
    const result = await fn(provider.client);
    s.failures = 0;
    s.cooldownUntil = 0;
    return result;
  } catch (error) {
    s.failures += 1;
    if (s.failures >= FAILURE_THRESHOLD) s.cooldownUntil = Date.now() + COOLDOWN_MS;
    console.warn('[ArcRpc] provider failed', {
      operation,
      provider: provider.url,
      failures: s.failures,
      coolingDown: s.cooldownUntil > Date.now(),
      reason: shortError(error),
    });
    throw error;
  } finally {
    s.inFlight = Math.max(0, s.inFlight - 1);
  }
}

async function failover<T>(operation: string, fn: (client: typeof clients[number]['client']) => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let pass = 0; pass < 2; pass += 1) {
    const now = Date.now();
    const healthy = clients.filter(provider => {
      const s = state(provider.url);
      return s.cooldownUntil <= now && s.inFlight === 0;
    });

    for (const provider of healthy) {
      try {
        return await runProvider(operation, provider, fn);
      } catch (error) {
        lastError = error;
      }
    }

    // Concurrent enrichment can briefly occupy the only configured provider.
    // Wait for a bounded interval instead of probing a provider that is still
    // in flight. The previous 25ms single wait was too short for normal RPC
    // latency and produced avoidable provider-failed noise/cooldowns.
    const healthyButBusy = clients.some(provider => {
      const s = state(provider.url);
      return s.cooldownUntil <= Date.now() && s.inFlight > 0;
    });
    if (pass === 0 && healthyButBusy) {
      const deadline = Date.now() + Math.max(BUSY_WAIT_MS, 750);
      while (Date.now() < deadline) {
        await sleep(Math.max(BUSY_WAIT_MS, 25));
        if (clients.some(provider => {
          const s = state(provider.url);
          return s.cooldownUntil <= Date.now() && s.inFlight === 0;
        })) break;
      }
      continue;
    }
    break;
  }

  // If every provider is cooling down, probe only the provider whose cooldown
  // expires first. This prevents the single-provider dead zone that previously
  // crashed arc-live for the entire cooldown window.
  const probe = clients
    .filter(provider => state(provider.url).inFlight === 0)
    .sort((a, b) => state(a.url).cooldownUntil - state(b.url).cooldownUntil)[0];

  if (probe) {
    try {
      return await runProvider(operation, probe, fn);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`No Arc RPC provider available for ${operation}`);
}

export const getArcBlockNumber = () => failover('blockNumber', client => client.getBlockNumber());
export const getArcLogs = (args: any) => failover('getLogs', client => client.getLogs(args as any) as Promise<any[]>);
export const getArcBlock = (args: any) => failover('getBlock', client => client.getBlock(args as any));
export const getArcBytecode = (address: `0x${string}`) => failover('getBytecode', client => client.getBytecode({ address }));
export const readArcContract = (args: any) => failover('readContract', client => client.readContract(args as any));

export async function verifyArcMainnet(): Promise<{ chainId: number; blockNumber: bigint }> {
  return failover('verify', async client => {
    const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    if (chainId !== 5042) throw new Error(`Unexpected Arc chain id ${chainId}; expected 5042`);
    return { chainId, blockNumber };
  });
}
