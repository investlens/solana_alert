import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';

import {
  PONS_CONTRACTS,
} from './ponsContracts.js';

import {
  requestRobinhoodRpcResilient,
} from './rpc.js';

const FACTORY_ABI =
  parseAbi([
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

async function rawEthCall(args: {
  address: Address;
  data: Hex;
}): Promise<Hex> {
  const result = await requestRobinhoodRpcResilient({
    method: 'eth_call',
    params: [
      {
        to: args.address,
        data: args.data,
      },
      'latest',
    ],
  });

  if (!result) {
    throw new Error(
      'Robinhood eth_call returned no result',
    );
  }

  return result as Hex;
}

export async function getPonsLaunchState(
  tokenAddress: string,
): Promise<PonsLaunchState> {
  const token =
    getAddress(
      tokenAddress,
    );

  const factory =
    getAddress(
      PONS_CONTRACTS.factory,
    );

  const data =
    encodeFunctionData({
      abi:
        FACTORY_ABI,

      functionName:
        'getLaunchedToken',

      args: [
        token,
      ],
    });

  const raw =
    await rawEthCall({
      address:
        factory,

      data,
    });

  const launched =
    decodeFunctionResult({
      abi:
        FACTORY_ABI,

      functionName:
        'getLaunchedToken',

      data:
        raw,
    });

  return {
    token:
      getAddress(
        launched.token,
      ),

    deployer:
      getAddress(
        launched.deployer,
      ),

    pairedToken:
      getAddress(
        launched.pairedToken,
      ),

    positionManager:
      getAddress(
        launched.positionManager,
      ),

    positionId:
      launched.positionId,

    dexId:
      launched.dexId,

    launchConfigId:
      launched.launchConfigId,

    restrictionsEndBlock:
      launched.restrictionsEndBlock,

    supply:
      launched.supply,

    isToken0:
      launched.isToken0,

    poolFee:
      Number(
        launched.poolFee,
      ),

    exists:
      launched.exists,

    initialBuyAmount:
      launched.initialBuyAmount,
  };
}
