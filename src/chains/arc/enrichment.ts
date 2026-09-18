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

export async function enrichArcCandidate(candidate: ArcLaunchCandidate): Promise<ArcTokenEnrichment> {
  const reasons: string[] = [];
  const bytecode = await getArcBytecode(candidate.assetId).catch(() => undefined);
  const contractCodePresent = Boolean(bytecode && bytecode !== '0x');
  if (!contractCodePresent) reasons.push('NO_CONTRACT_CODE');

  // ARC production currently has a small RPC provider set guarded against
  // concurrent stampedes. Read the tiny ERC-20 metadata set sequentially so
  // valid tokens are not misclassified merely because another eth_call is in flight.
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
