import { parseAbi } from 'viem';
import type { ArcLaunchCandidate } from './candidate.js';
import { getArcBytecode, readArcContract } from './rpc.js';

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
]);

export type ArcTokenEnrichment = ArcLaunchCandidate & {
  contractCodePresent: boolean;
  metadataReadable: boolean;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupplyRaw: bigint | null;
  eligibleForScoring: boolean;
  safetyReasons: string[];
};

async function safeRead<T>(address: `0x${string}`, functionName: string): Promise<T | null> {
  try {
    return await readArcContract({ address, abi: ERC20_ABI, functionName }) as T;
  } catch {
    return null;
  }
}

type ArcFacts = Pick<ArcTokenEnrichment, 'contractCodePresent' | 'metadataReadable' | 'name' | 'symbol' | 'decimals' | 'totalSupplyRaw' | 'eligibleForScoring' | 'safetyReasons'>;
export function canRetryArcEnrichment(value: ArcTokenEnrichment): boolean {
  return value.hooks.toLowerCase() === '0x0000000000000000000000000000000000000000'
    && value.safetyReasons.every(reason => ['ERC20_METADATA_UNREADABLE', 'CONTRACT_CODE_UNAVAILABLE', 'METADATA_CAPACITY_UNAVAILABLE'].includes(reason));
}
const factsCache = new Map<string, { expires: number; facts: ArcFacts }>();
const factsInflight = new Map<string, Promise<ArcTokenEnrichment>>();
export async function enrichArcCandidate(candidate: ArcLaunchCandidate): Promise<ArcTokenEnrichment> {
  const key = candidate.assetId.toLowerCase();
  const cached = factsCache.get(key);
  if (cached && cached.expires > Date.now()) return { ...candidate, ...cached.facts, safetyReasons: [...cached.facts.safetyReasons] };
  const pending = factsInflight.get(key);
  if (pending) { const value = await pending; return { ...value, ...candidate }; }
  if (factsInflight.size >= 16) return { ...candidate, contractCodePresent: false, metadataReadable: false,
    name: null, symbol: null, decimals: null, totalSupplyRaw: null, eligibleForScoring: false, safetyReasons: ['METADATA_CAPACITY_UNAVAILABLE'] };
  const work = readArcCandidate(candidate).then(value => {
    const { contractCodePresent, metadataReadable, name, symbol, decimals, totalSupplyRaw, eligibleForScoring, safetyReasons } = value;
    if (factsCache.size >= 200) factsCache.delete(factsCache.keys().next().value!);
    factsCache.set(key, { expires: Date.now() + (eligibleForScoring ? 30_000 : 5_000),
      facts: { contractCodePresent, metadataReadable, name, symbol, decimals, totalSupplyRaw, eligibleForScoring, safetyReasons } });
    return value;
  }).finally(() => factsInflight.delete(key));
  factsInflight.set(key, work);
  return work;
}

async function readArcCandidate(candidate: ArcLaunchCandidate): Promise<ArcTokenEnrichment> {
  const reasons: string[] = [];
  let codeReadFailed = false;
  const bytecode = await getArcBytecode(candidate.assetId).catch(() => { codeReadFailed = true; return undefined; });
  const contractCodePresent = Boolean(bytecode && bytecode !== '0x');

  // Fail closed before any ERC-20 eth_call. A transfer/log can contain an
  // address that is not a token contract (system/precompile/sentinel/EOA).
  // Calling symbol/decimals/totalSupply/name on those addresses returns empty
  // data and used to count as RPC-provider failures, eventually cooling down a
  // healthy provider and starving unrelated ARC candidates/burn verification.
  if (!contractCodePresent) {
    // viem also returns undefined for an actual empty-code account. Only a
    // rejected RPC request warrants a temporary retry.
    reasons.push(codeReadFailed ? 'CONTRACT_CODE_UNAVAILABLE' : 'NO_CONTRACT_CODE');
    return {
      ...candidate,
      contractCodePresent: false,
      metadataReadable: false,
      name: null,
      symbol: null,
      decimals: null,
      totalSupplyRaw: null,
      eligibleForScoring: false,
      safetyReasons: reasons,
    };
  }

  // Only proven contracts reach the ERC-20 metadata calls. Keep these reads
  // sequential because ARC production has a deliberately small RPC provider set.
  const symbol = await safeRead<string>(candidate.assetId, 'symbol');
  const decimalsRaw = await safeRead<number>(candidate.assetId, 'decimals');
  const totalSupplyRaw = await safeRead<bigint>(candidate.assetId, 'totalSupply');
  const name = await safeRead<string>(candidate.assetId, 'name');

  const decimals = decimalsRaw === null ? null : Number(decimalsRaw);
  const metadataReadable = Boolean(symbol && decimals !== null && totalSupplyRaw !== null);
  if (!metadataReadable) reasons.push('ERC20_METADATA_UNREADABLE');
  if (decimals !== null && (decimals < 0 || decimals > 36)) reasons.push('SUSPICIOUS_DECIMALS');
  if (totalSupplyRaw !== null && totalSupplyRaw <= 0n) reasons.push('ZERO_TOTAL_SUPPLY');

  return {
    ...candidate,
    contractCodePresent,
    metadataReadable,
    name: name?.trim() || null,
    symbol: symbol?.trim() || null,
    decimals,
    totalSupplyRaw,
    eligibleForScoring: reasons.length === 0,
    safetyReasons: reasons,
  };
}
