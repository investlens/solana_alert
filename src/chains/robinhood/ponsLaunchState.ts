import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';

import {
  robinhoodChain,
} from './config.js';

import {
  PONS_CONTRACTS,
} from './ponsContracts.js';

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
  const rpcUrl =
    robinhoodChain
      .rpcUrls
      .default
      .http[0];

  const response =
    await fetch(
      rpcUrl,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify({
            jsonrpc:
              '2.0',

            id:
              1,

            method:
              'eth_call',

            params: [
              {
                to:
                  args.address,

                data:
                  args.data,
              },

              'latest',
            ],
          }),
      },
    );

  if (!response.ok) {
    throw new Error(
      `Robinhood eth_call HTTP ${response.status}`,
    );
  }

  const payload =
    await response.json() as {
      result?: Hex;

      error?: {
        code?: number;
        message?: string;
      };
    };

  if (payload.error) {
    throw new Error(
      payload.error.message ??
      'Robinhood eth_call failed',
    );
  }

  if (!payload.result) {
    throw new Error(
      'Robinhood eth_call returned no result',
    );
  }

  return payload.result;
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
