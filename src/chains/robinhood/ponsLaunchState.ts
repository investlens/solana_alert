import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';

import { PONS_CONTRACTS, getPonsFactoryDeployments } from './ponsContracts.js';
import { requestRobinhoodRpcResilient } from './rpc.js';
import { supabase } from '../../services/supabase.js';
import { getSharedJson } from '../../services/sharedJsonCache.js';

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

export type PonsProvenance = 'PONS' | 'CUSTOM' | 'UNKNOWN';

export function decidePonsProvenanceEvidence(args: {
  sharedVerified: boolean;
  indexedFound: boolean;
  indexedAvailable: boolean;
  directFound: boolean;
}): PonsProvenance {
  if (args.sharedVerified || args.indexedFound || args.directFound) return 'PONS';
  // A healthy launch index is the only negative evidence we currently trust
  // across both V1 and V2 factory generations. During a DB outage we must not
  // convert "could not verify" into the user-facing claim "CUSTOM".
  if (args.indexedAvailable) return 'CUSTOM';
  return 'UNKNOWN';
}

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

async function indexedPonsLaunch(token: Address): Promise<{ found: boolean; available: boolean }> {
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
    return { found: Boolean(data?.token_address), available: true };
  } catch (error) {
    console.warn('[PonsLaunchState] indexed PONS provenance lookup failed', {
      token,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { found: false, available: false };
  }
}

export async function classifyPonsLaunchProvenance(tokenAddress: string): Promise<PonsProvenance> {
  const token = getAddress(tokenAddress);
  const shared = await getSharedJson<{ factory?: string; protocolVersion?: string }>(
    `alphaos:pons:verified:${token.toLowerCase()}`,
  );
  if (shared) return 'PONS';

  const indexed = await indexedPonsLaunch(token);
  if (indexed.found) return 'PONS';

  let directFound = false;
  try {
    directFound = Boolean((await getPonsLaunchState(tokenAddress)).exists);
  } catch (error) {
    console.warn('[PonsLaunchState] direct factory provenance unavailable', {
      token,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return decidePonsProvenanceEvidence({
    sharedVerified: false,
    indexedFound: indexed.found,
    indexedAvailable: indexed.available,
    directFound,
  });
}

export async function isVerifiedPonsLaunch(tokenAddress: string): Promise<boolean> {
  const provenance = await classifyPonsLaunchProvenance(tokenAddress);
  if (provenance === 'PONS') return true;
  if (provenance === 'CUSTOM') return false;
  // Accuracy over guesswork: BOOST must not label an unknown-origin token as
  // CUSTOM during an index/provider outage. The observer catches this error and
  // skips that token for this cycle; a later cycle can classify it once evidence
  // is available.
  throw new Error(`PONS_PROVENANCE_UNKNOWN:${getAddress(tokenAddress)}`);
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
  options: { skipIndexedLookup?: boolean } = {},
): Promise<PonsLaunchState> {
  const token = getAddress(tokenAddress);
  const activeFactory = getAddress(PONS_CONTRACTS.factory);

  // During database recovery, fresh V1-token classification can verify directly
  // against the current PONS factory. V2 provenance is supplied by the live
  // launch cache / persistent PONS index; we never infer CUSTOM from a V2 view
  // call that is unavailable.
  if (options.skipIndexedLookup) {
    return readLaunchFromFactory(token, activeFactory);
  }

  const indexedFactory = await indexedFactoryForToken(token);
  const factories = [...new Set([
    indexedFactory,
    activeFactory,
    ...getPonsFactoryDeployments().filter(factory => factory.generation === 'v1').map(factory => getAddress(factory.address)),
  ].filter((value): value is Address => Boolean(value)).map(value => value.toLowerCase()))].map(value => getAddress(value));

  let fallback: PonsLaunchState | null = null;
  for (const factory of factories) {
    try {
      const launch = await readLaunchFromFactory(token, factory);
      fallback ??= launch;
      if (launch.exists) return launch;
    } catch (error) {
      console.warn('[PonsLaunchState] factory verification failed; trying next known V1 PONS factory', {
        token,
        factory,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (fallback) return fallback;
  throw new Error(`Unable to verify V1 PONS launch state for ${token}`);
}
