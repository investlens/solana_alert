import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  padHex,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from 'viem';

import { PONS_CONTRACTS, getPonsFactoryDeployments } from './ponsContracts.js';
import { requestRobinhoodRpcResilient } from './rpc.js';
import { supabase } from '../../services/supabase.js';
import { getSharedJson, setSharedJson } from '../../services/sharedJsonCache.js';

const FACTORY_ABI = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token,address deployer,address pairedToken,address positionManager,uint256 positionId,uint256 dexId,uint256 launchConfigId,uint256 restrictionsEndBlock,uint256 supply,bool isToken0,uint24 poolFee,bool exists,uint256 initialBuyAmount) launched)',
]);

export type PonsLaunchState = {
  token: Address;
  deployer: Address;
  pairedToken: Address;
  positionManager: Address;
  positionId: bigint;
  dexId: bigint;
  launchConfigId: bigint;
  restrictionsEndBlock: bigint;
  supply: bigint;
  isToken0: boolean;
  poolFee: number;
  exists: boolean;
  initialBuyAmount: bigint;
};

async function rawEthCall(args: { address: Address; data: Hex }): Promise<Hex> {
  const result = await requestRobinhoodRpcResilient({
    method: 'eth_call',
    params: [{ to: args.address, data: args.data }, 'latest'],
  });
  if (!result) throw new Error('Robinhood eth_call returned no result');
  return result as Hex;
}

async function indexedFactoryForToken(token: Address): Promise<Address | null> {
  try {
    const { data, error } = await supabase
      .from('pons_launches')
      .select('factory_address')
      .eq('chain', 'robinhood')
      .ilike('token_address', token.toLowerCase())
      .order('block_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const factoryAddress = String(data?.factory_address ?? '').trim();
    return factoryAddress ? getAddress(factoryAddress) : null;
  } catch (error) {
    console.warn('[PonsLaunchState] indexed factory lookup failed; using active factory fallback', {
      token,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function indexedPonsLaunchExists(token: Address): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('pons_launches')
      .select('token_address')
      .eq('chain', 'robinhood')
      .eq('protocol', 'pons')
      .ilike('token_address', token.toLowerCase())
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.token_address);
  } catch (error) {
    console.warn('[PonsLaunchState] indexed PONS provenance lookup failed', {
      token,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

const eventVerificationCache = new Map<string, { value: boolean; expiresAt: number }>();
const PONS_TRUE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const PONS_FALSE_CACHE_MS = 60 * 60 * 1000;

function eventSignature(eventDeclaration: string): string {
  const match = eventDeclaration.match(/^event\s+([^(]+)\((.*)\)$/);
  if (!match) throw new Error(`Invalid event declaration: ${eventDeclaration}`);
  const name = match[1].trim();
  const params = match[2]
    .split(',')
    .map(part => part.trim().split(/\s+/)[0])
    .join(',');
  return `${name}(${params})`;
}

async function verifyPonsLaunchEvent(token: Address): Promise<boolean> {
  const key = token.toLowerCase();
  const cached = eventVerificationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const tokenTopic = padHex(token, { size: 32 });
  for (const deployment of getPonsFactoryDeployments()) {
    if (deployment.startBlock == null) continue;
    try {
      const topic0 = keccak256(toHex(eventSignature(deployment.tokenLaunchedEvent)));
      const logs = await requestRobinhoodRpcResilient<unknown[]>({
        method: 'eth_getLogs',
        params: [{
          address: deployment.address,
          fromBlock: `0x${deployment.startBlock.toString(16)}`,
          toBlock: 'latest',
          topics: [topic0, tokenTopic],
        }],
      });
      if (Array.isArray(logs) && logs.length > 0) {
        eventVerificationCache.set(key, { value: true, expiresAt: Date.now() + PONS_TRUE_CACHE_MS });
        void setSharedJson(
          `alphaos:pons:verified:${key}`,
          { factory: deployment.address, protocolVersion: deployment.generation, provenance: 'TOKEN_LAUNCHED_EVENT' },
          new Date().toISOString(),
          PONS_TRUE_CACHE_MS,
        );
        console.log('[PonsLaunchState] PONS provenance verified from TokenLaunched event.', {
          token: key,
          factory: deployment.address,
          generation: deployment.generation,
        });
        return true;
      }
    } catch (error) {
      console.warn('[PonsLaunchState] event provenance verification unavailable for factory', {
        token: key,
        factory: deployment.address,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  eventVerificationCache.set(key, { value: false, expiresAt: Date.now() + PONS_FALSE_CACHE_MS });
  return false;
}

export async function isVerifiedPonsLaunch(tokenAddress: string): Promise<boolean> {
  const token = getAddress(tokenAddress);
  const shared = await getSharedJson<{ factory?: string; protocolVersion?: string }>(
    `alphaos:pons:verified:${token.toLowerCase()}`,
  );
  if (shared) return true;
  if (await indexedPonsLaunchExists(token)) return true;
  try {
    if ((await getPonsLaunchState(tokenAddress)).exists) return true;
  } catch {
    // V2 factories do not expose the V1 getLaunchedToken() view; continue to
    // authoritative TokenLaunched event verification below.
  }
  return verifyPonsLaunchEvent(token);
}

async function readLaunchFromFactory(token: Address, factory: Address): Promise<PonsLaunchState> {
  const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: 'getLaunchedToken', args: [token] });
  const raw = await rawEthCall({ address: factory, data });
  const launched = decodeFunctionResult({ abi: FACTORY_ABI, functionName: 'getLaunchedToken', data: raw });
  return {
    token: getAddress(launched.token),
    deployer: getAddress(launched.deployer),
    pairedToken: getAddress(launched.pairedToken),
    positionManager: getAddress(launched.positionManager),
    positionId: launched.positionId,
    dexId: launched.dexId,
    launchConfigId: launched.launchConfigId,
    restrictionsEndBlock: launched.restrictionsEndBlock,
    supply: launched.supply,
    isToken0: launched.isToken0,
    poolFee: Number(launched.poolFee),
    exists: launched.exists,
    initialBuyAmount: launched.initialBuyAmount,
  };
}

export async function getPonsLaunchState(
  tokenAddress: string,
  options: {
    skipIndexedLookup?: boolean;
    requireCompleteFactoryVerification?: boolean;
  } = {},
): Promise<PonsLaunchState> {
  const token = getAddress(tokenAddress);
  const activeFactory = getAddress(PONS_CONTRACTS.factory);

  // During database recovery, fresh-token classification can verify directly
  // against the authoritative current PONS factory without touching PostgREST.
  if (options.skipIndexedLookup) {
    return readLaunchFromFactory(token, activeFactory);
  }

  const indexedFactory = await indexedFactoryForToken(token);
  const factories = [...new Set([
    indexedFactory,
    activeFactory,
    ...getPonsFactoryDeployments().map(factory => getAddress(factory.address)),
  ].filter((value): value is Address => Boolean(value)).map(value => value.toLowerCase()))].map(value => getAddress(value));

  let fallback: PonsLaunchState | null = null;
  let factoryVerificationFailed = false;
  for (const factory of factories) {
    try {
      const launch = await readLaunchFromFactory(token, factory);
      fallback ??= launch;
      if (launch.exists) return launch;
    } catch (error) {
      factoryVerificationFailed = true;
      console.warn('[PonsLaunchState] factory verification failed; trying next known PONS factory', {
        token,
        factory,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (fallback) {
    if (options.requireCompleteFactoryVerification && factoryVerificationFailed) {
      throw new Error(
        `Unable to completely verify PONS launch state for ${token} across known factories`,
      );
    }
    return fallback;
  }
  throw new Error(`Unable to verify PONS launch state for ${token} across known factories`);
}
