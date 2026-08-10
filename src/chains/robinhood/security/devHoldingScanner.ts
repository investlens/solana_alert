import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';

import {
  robinhoodChain,
} from '../config.js';

import {
  getPonsLaunchState,
} from '../ponsLaunchState.js';

import {
  getRobinhoodTokenMetadata,
} from '../tokenMetadata.js';

const ERC20_BALANCE_ABI =
  parseAbi([
    'function balanceOf(address account) view returns (uint256)',
  ]);

export type RobinhoodDevHoldingResult = {
  tokenAddress: Address;

  deployerAddress:
    Address | null;

  balanceRaw:
    bigint | null;

  balanceTokens:
    number | null;

  holdingPercent:
    number | null;

  status:
    | 'KNOWN'
    | 'ZERO'
    | 'UNKNOWN';

  warnings:
    string[];

  scannedAt: number;
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
        message?: string;
      };
    };

  if (payload.error) {
    throw new Error(
      payload.error.message ??
      'Robinhood eth_call failed',
    );
  }

  if (
    !payload.result ||
    payload.result === '0x'
  ) {
    throw new Error(
      'balanceOf returned no result',
    );
  }

  return payload.result;
}

export async function scanRobinhoodDevHolding(
  tokenAddress: string,
): Promise<RobinhoodDevHoldingResult> {
  const token =
    getAddress(
      tokenAddress,
    );

  const warnings:
    string[] = [];

  try {
    const [
      launch,
      metadata,
    ] =
      await Promise.all([
        getPonsLaunchState(
          token,
        ),

        getRobinhoodTokenMetadata(
          token,
        ),
      ]);

    if (!launch.exists) {
      return {
        tokenAddress:
          token,

        deployerAddress:
          null,

        balanceRaw:
          null,

        balanceTokens:
          null,

        holdingPercent:
          null,

        status:
          'UNKNOWN',

        warnings: [
          'PONS deployer could not be verified',
        ],

        scannedAt:
          Date.now(),
      };
    }

    if (
      metadata.totalSupplyRaw == null ||
      metadata.totalSupplyRaw <= 0n ||
      metadata.decimals == null
    ) {
      return {
        tokenAddress:
          token,

        deployerAddress:
          launch.deployer,

        balanceRaw:
          null,

        balanceTokens:
          null,

        holdingPercent:
          null,

        status:
          'UNKNOWN',

        warnings: [
          'Token supply unavailable',
        ],

        scannedAt:
          Date.now(),
      };
    }

    const data =
      encodeFunctionData({
        abi:
          ERC20_BALANCE_ABI,

        functionName:
          'balanceOf',

        args: [
          launch.deployer,
        ],
      });

    const raw =
      await rawEthCall({
        address:
          token,

        data,
      });

    const balanceRaw =
      decodeFunctionResult({
        abi:
          ERC20_BALANCE_ABI,

        functionName:
          'balanceOf',

        data:
          raw,
      });

    const holdingPercent =
      Number(
        balanceRaw *
        1_000_000n /
        metadata.totalSupplyRaw,
      ) /
      10_000;

    const balanceTokens =
      Number(
        formatUnits(
          balanceRaw,
          metadata.decimals,
        ),
      );

    return {
      tokenAddress:
        token,

      deployerAddress:
        launch.deployer,

      balanceRaw,

      balanceTokens,

      holdingPercent,

      status:
        balanceRaw === 0n
          ? 'ZERO'
          : 'KNOWN',

      warnings,

      scannedAt:
        Date.now(),
    };
  } catch (error) {
    return {
      tokenAddress:
        token,

      deployerAddress:
        null,

      balanceRaw:
        null,

      balanceTokens:
        null,

      holdingPercent:
        null,

      status:
        'UNKNOWN',

      warnings: [
        error instanceof Error
          ? error.message
          : String(error),
      ],

      scannedAt:
        Date.now(),
    };
  }
}
