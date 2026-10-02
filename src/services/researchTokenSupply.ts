import { createPublicClient, defineChain, http, parseAbi, formatUnits, type Address } from 'viem';
import { researchChains, type ResearchChain } from './addressResearch.js';

const abi = parseAbi(['function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)']);
export type ResearchTokenSupply = { totalSupplyRaw: bigint; decimals: number; blockNumber: bigint; checkedAt: string };
type SupplyRead = Omit<ResearchTokenSupply, 'checkedAt'> & { chainId: number };
async function loadSupply(address: string, chain: ResearchChain): Promise<SupplyRead> {
  const config = researchChains[chain];
  const rpcChain = defineChain({ id: config.id, name: config.label, nativeCurrency: { name: config.native, symbol: config.native, decimals: config.decimals }, rpcUrls: { default: { http: [config.rpc] } } });
  const client = createPublicClient({ chain: rpcChain, transport: http(researchChains[chain].rpc, {
    timeout: 2_000, retryCount: 0, batch: { wait: 10, batchSize: 4 },
    fetchOptions: { signal: AbortSignal.timeout(3_000) },
  }) });
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  if (chainId !== researchChains[chain].id) throw new Error('Supply chain mismatch');
  const [decimals, totalSupplyRaw] = await Promise.all([
    client.readContract({ address: address as Address, abi, functionName: 'decimals', blockNumber, authorizationList: undefined }),
    client.readContract({ address: address as Address, abi, functionName: 'totalSupply', blockNumber, authorizationList: undefined }),
  ]);
  return { chainId, decimals, totalSupplyRaw, blockNumber };
}

export function createResearchSupplyReader(load = loadSupply, clock = Date.now) {
  const cache = new Map<string, { expires: number; value: ResearchTokenSupply | null }>();
  const pending = new Map<string, Promise<ResearchTokenSupply | null>>();
  let windowStart = 0, reads = 0;
  return async (address: string, chain: ResearchChain): Promise<ResearchTokenSupply | null> => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address) || !researchChains[chain]) return null;
    const key = `${chain}:${address.toLowerCase()}`, now = clock();
    const saved = cache.get(key); if (saved && saved.expires > now) return saved.value;
    if (pending.has(key)) return pending.get(key)!;
    if (now - windowStart >= 60_000) { windowStart = now; reads = 0; }
    if (pending.size >= 3 || reads >= 10) return null;
    reads++;
    const work = (async () => {
      let value: ResearchTokenSupply | null = null;
      try {
        const row = await load(address, chain);
        if (row.chainId === researchChains[chain].id && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 255
          && typeof row.totalSupplyRaw === 'bigint' && row.totalSupplyRaw >= 0n && typeof row.blockNumber === 'bigint' && row.blockNumber >= 0n) {
          value = { totalSupplyRaw: row.totalSupplyRaw, decimals: row.decimals, blockNumber: row.blockNumber, checkedAt: new Date(clock()).toISOString() };
        }
      } catch { /* Omit unavailable supply; market research remains usable. */ }
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { value, expires: clock() + (value ? 60_000 : 15_000) });
      return value;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  };
}
export const readResearchTokenSupply = createResearchSupplyReader();
export function formatResearchSupply(value: Pick<ResearchTokenSupply, 'totalSupplyRaw' | 'decimals'>): string {
  const amount = Number(formatUnits(value.totalSupplyRaw, value.decimals));
  return amount > 0 && amount < 0.01 ? '<0.01' : amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
