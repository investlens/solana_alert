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

export async function isVerifiedPonsLaunch(tokenAddress: string): Promise<boolean> {
  const token = getAddress(tokenAddress);
  if (await indexedPonsLaunchExists(token)) return true;
  try {
    return Boolean((await getPonsLaunchState(tokenAddress)).exists);
  } catch {
    return false;
  }
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

  // During database recovery, fresh-token classification can verify directly
  // against the authoritative current PONS factory without touching PostgREST.
  if (options.skipIndexedLookup) {
    return readLaunchFromFactory(token, activeFactory);
  }

  const indexedFactory = await indexedFactoryForToken(token);
  const factories = [...new Set([
    indexedFactory,
    activeFactory,
    ...getPonsFactoryDeployments().filter(factory => factory.enabled).map(factory => getAddress(factory.address)),
  ].filter((value): value is Address => Boolean(value)).map(value => value.toLowerCase()))].map(value => getAddress(value));

  let fallback: PonsLaunchState | null = null;
  for (const factory of factories) {
    try {
      const launch = await readLaunchFromFactory(token, factory);
      fallback ??= launch;
      if (launch.exists) return launch;
    } catch (error) {
      console.warn('[PonsLaunchState] factory verification failed; trying next known PONS factory', {
        token,
        factory,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (fallback) return fallback;
  throw new Error(`Unable to verify PONS launch state for ${token} across known factories`);
}
