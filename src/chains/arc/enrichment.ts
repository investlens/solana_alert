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

  // Fail closed before any ERC-20 eth_call. A transfer/log can contain an
  // address that is not a token contract (system/precompile/sentinel/EOA).
  // Calling symbol/decimals/totalSupply/name on those addresses returns empty
  // data and used to count as RPC-provider failures, eventually cooling down a
  // healthy provider and starving unrelated ARC candidates/burn verification.
  if (!contractCodePresent) {
    reasons.push('NO_CONTRACT_CODE');
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
