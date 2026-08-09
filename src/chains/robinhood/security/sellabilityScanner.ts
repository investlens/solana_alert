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
  PONS_CONTRACTS,
} from '../ponsContracts.js';

import {
  getPonsLaunchState,
} from '../ponsLaunchState.js';

import {
  getRobinhoodTokenMetadata,
} from '../tokenMetadata.js';

const QUOTER_V2_ABI =
  parseAbi([
    'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
  ]);

export type SellabilityStatus =
  | 'SELLABLE'
  | 'HIGH_IMPACT'
  | 'NO_QUOTE'
  | 'UNSUPPORTED'
  | 'ERROR';

export type SellQuoteResult = {
  amountInRaw: bigint;

  amountInTokens: string;

  amountOutRaw: bigint;

  amountOutWeth: string;

  sqrtPriceX96After: bigint;

  initializedTicksCrossed: number;

  gasEstimate: bigint;
};

export type RobinhoodSellabilityResult = {
  chain: 'robinhood';

  tokenAddress: Address;

  pairedToken: Address | null;

  poolFee: number | null;

  ponsVerified: boolean;

  status: SellabilityStatus;

  sellable: boolean;

  smallQuote: SellQuoteResult | null;

  largeQuote: SellQuoteResult | null;

  estimatedImpactPercent: number | null;

  warnings: string[];

  blockers: string[];

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
        code?: number;
        message?: string;
        data?: unknown;
      };
    };

  if (payload.error) {
    throw new Error(
      `Quoter eth_call failed: ` +
      `${payload.error.code ?? ''} ` +
      `${payload.error.message ?? 'Unknown RPC error'}`,
    );
  }

  if (
    !payload.result ||
    payload.result === '0x'
  ) {
    throw new Error(
      'Quoter returned no result',
    );
  }

  return payload.result;
}

async function quoteTokenToWeth(args: {
  token: Address;

  weth: Address;

  amountIn: bigint;

  fee: number;

  decimals: number;
}): Promise<SellQuoteResult> {
  const data =
    encodeFunctionData({
      abi:
        QUOTER_V2_ABI,

      functionName:
        'quoteExactInputSingle',

      args: [
        {
          tokenIn:
            args.token,

          tokenOut:
            args.weth,

          amountIn:
            args.amountIn,

          fee:
            args.fee,

          sqrtPriceLimitX96:
            0n,
        },
      ],
    });

  const raw =
    await rawEthCall({
      address:
        getAddress(
          PONS_CONTRACTS.quoterV2,
        ),

      data,
    });

  const decoded =
    decodeFunctionResult({
      abi:
        QUOTER_V2_ABI,

      functionName:
        'quoteExactInputSingle',

      data:
        raw,
    });

  const [
    amountOut,
    sqrtPriceX96After,
    initializedTicksCrossed,
    gasEstimate,
  ] = decoded;

  return {
    amountInRaw:
      args.amountIn,

    amountInTokens:
      formatUnits(
        args.amountIn,
        args.decimals,
      ),

    amountOutRaw:
      amountOut,

    amountOutWeth:
      formatUnits(
        amountOut,
        18,
      ),

    sqrtPriceX96After,

    initializedTicksCrossed:
      Number(
        initializedTicksCrossed,
      ),

    gasEstimate,
  };
}

function quoteRate(
  quote: SellQuoteResult,
): number | null {
  const amountIn =
    Number(
      quote.amountInTokens,
    );

  const amountOut =
    Number(
      quote.amountOutWeth,
    );

  if (
    !Number.isFinite(amountIn) ||
    amountIn <= 0 ||
    !Number.isFinite(amountOut) ||
    amountOut <= 0
  ) {
    return null;
  }

  return amountOut /
    amountIn;
}

function calculateImpactPercent(
  smallQuote: SellQuoteResult,
  largeQuote: SellQuoteResult,
): number | null {
  const smallRate =
    quoteRate(
      smallQuote,
    );

  const largeRate =
    quoteRate(
      largeQuote,
    );

  if (
    smallRate == null ||
    largeRate == null ||
    smallRate <= 0
  ) {
    return null;
  }

  const deterioration =
    (1 -
      largeRate /
        smallRate) *
    100;

  return Math.max(
    0,
    deterioration,
  );
}

export async function scanPonsSellability(
  tokenAddress: string,
): Promise<RobinhoodSellabilityResult> {
  const token =
    getAddress(
      tokenAddress,
    );

  const scannedAt =
    Date.now();

  const warnings:
    string[] = [];

  const blockers:
    string[] = [];

  let launch;

  try {
    launch =
      await getPonsLaunchState(
        token,
      );
  } catch (error) {
    blockers.push(
      `Could not verify PONS launch: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );

    return {
      chain:
        'robinhood',

      tokenAddress:
        token,

      pairedToken:
        null,

      poolFee:
        null,

      ponsVerified:
        false,

      status:
        'UNSUPPORTED',

      sellable:
        false,

      smallQuote:
        null,

      largeQuote:
        null,

      estimatedImpactPercent:
        null,

      warnings,

      blockers,

      scannedAt,
    };
  }

  if (!launch.exists) {
    blockers.push(
      'Token is not registered by the active PONS factory',
    );

    return {
      chain:
        'robinhood',

      tokenAddress:
        token,

      pairedToken:
        launch.pairedToken,

      poolFee:
        launch.poolFee,

      ponsVerified:
        false,

      status:
        'UNSUPPORTED',

      sellable:
        false,

      smallQuote:
        null,

      largeQuote:
        null,

      estimatedImpactPercent:
        null,

      warnings,

      blockers,

      scannedAt,
    };
  }

  const officialWeth =
    getAddress(
      PONS_CONTRACTS.weth,
    );

  if (
    launch.pairedToken
      .toLowerCase() !==
    officialWeth
      .toLowerCase()
  ) {
    blockers.push(
      'PONS paired token does not match configured WETH',
    );
  }

  if (
    launch.poolFee <= 0
  ) {
    blockers.push(
      'Invalid PONS pool fee',
    );
  }

  const metadata =
    await getRobinhoodTokenMetadata(
      token,
    );

  if (
    metadata.decimals == null ||
    metadata.totalSupplyRaw == null ||
    metadata.totalSupplyRaw <= 0n
  ) {
    blockers.push(
      'Token supply or decimals unavailable',
    );

    return {
      chain:
        'robinhood',

      tokenAddress:
        token,

      pairedToken:
        launch.pairedToken,

      poolFee:
        launch.poolFee,

      ponsVerified:
        true,

      status:
        'ERROR',

      sellable:
        false,

      smallQuote:
        null,

      largeQuote:
        null,

      estimatedImpactPercent:
        null,

      warnings,

      blockers,

      scannedAt,
    };
  }

  if (
    blockers.length > 0
  ) {
    return {
      chain:
        'robinhood',

      tokenAddress:
        token,

      pairedToken:
        launch.pairedToken,

      poolFee:
        launch.poolFee,

      ponsVerified:
        true,

      status:
        'UNSUPPORTED',

      sellable:
        false,

      smallQuote:
        null,

      largeQuote:
        null,

      estimatedImpactPercent:
        null,

      warnings,

      blockers,

      scannedAt,
    };
  }

  /*
   * Test approximately:
   *
   * 0.01% of total supply
   * 0.10% of total supply
   *
   * This does not require owning the tokens.
   * The Quoter simulates the pool route.
   */
  const smallAmount =
    metadata.totalSupplyRaw /
    10_000n;

  const largeAmount =
    metadata.totalSupplyRaw /
    1_000n;

  let smallQuote:
    SellQuoteResult | null =
      null;

  let largeQuote:
    SellQuoteResult | null =
      null;

  try {
    smallQuote =
      await quoteTokenToWeth({
        token,

        weth:
          officialWeth,

        amountIn:
          smallAmount,

        fee:
          launch.poolFee,

        decimals:
          metadata.decimals,
      });
  } catch (error) {
    blockers.push(
      `Small sell quote failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );

    return {
      chain:
        'robinhood',

      tokenAddress:
        token,

      pairedToken:
        officialWeth,

      poolFee:
        launch.poolFee,

      ponsVerified:
        true,

      status:
        'NO_QUOTE',

      sellable:
        false,

      smallQuote:
        null,

      largeQuote:
        null,

      estimatedImpactPercent:
        null,

      warnings,

      blockers,

      scannedAt,
    };
  }

  if (
    smallQuote.amountOutRaw <=
    0n
  ) {
    blockers.push(
      'Small sell quote returned zero WETH',
    );

    return {
      chain:
        'robinhood',

      tokenAddress:
        token,

      pairedToken:
        officialWeth,

      poolFee:
        launch.poolFee,

      ponsVerified:
        true,

      status:
        'NO_QUOTE',

      sellable:
        false,

      smallQuote,

      largeQuote:
        null,

      estimatedImpactPercent:
        null,

      warnings,

      blockers,

      scannedAt,
    };
  }

  try {
    largeQuote =
      await quoteTokenToWeth({
        token,

        weth:
          officialWeth,

        amountIn:
          largeAmount,

        fee:
          launch.poolFee,

        decimals:
          metadata.decimals,
      });
  } catch (error) {
    warnings.push(
      `Large sell quote failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }

  if (!largeQuote) {
    return {
      chain:
        'robinhood',

      tokenAddress:
        token,

      pairedToken:
        officialWeth,

      poolFee:
        launch.poolFee,

      ponsVerified:
        true,

      status:
        'HIGH_IMPACT',

      sellable:
        true,

      smallQuote,

      largeQuote:
        null,

      estimatedImpactPercent:
        null,

      warnings,

      blockers,

      scannedAt,
    };
  }

  const impact =
    calculateImpactPercent(
      smallQuote,
      largeQuote,
    );

  /*
   * Initial observation threshold.
   *
   * This is not yet a permanent AlphaOS rule.
   * We will learn appropriate Robinhood
   * thresholds from actual outcomes.
   */
  const highImpact =
    impact != null &&
    impact >= 20;

  if (highImpact) {
    warnings.push(
      `Exit rate deteriorates approximately ${impact.toFixed(1)}% at the larger test size`,
    );
  }

  return {
    chain:
      'robinhood',

    tokenAddress:
      token,

    pairedToken:
      officialWeth,

    poolFee:
      launch.poolFee,

    ponsVerified:
      true,

    status:
      highImpact
        ? 'HIGH_IMPACT'
        : 'SELLABLE',

    sellable:
      true,

    smallQuote,

    largeQuote,

    estimatedImpactPercent:
      impact,

    warnings,

    blockers,

    scannedAt,
  };
}
