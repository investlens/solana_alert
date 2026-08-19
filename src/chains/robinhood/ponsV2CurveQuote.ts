import {
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  getAddress,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from 'viem';

import {
  robinhoodPublicClient,
} from './rpc.js';


const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000' as const;


const BASIS_POINTS =
  10_000n;


const CURVE_ABI =
  parseAbi([
    'function token() view returns (address)',
    'function pairToken() view returns (address)',
    'function getReserves() view returns (uint256 quoteReserve,uint256 tokenReserve)',
    'function quoteReserve() view returns (uint256)',
    'function tokenReserve() view returns (uint256)',
    'function reservedTokens() view returns (uint256)',
    'function sellableTokens() view returns (uint256)',
    'function feeBps() view returns (uint256)',
    'function creatorTaxBps() view returns (uint256)',
    'function graduated() view returns (bool)',
  ]);


export type PonsV2CurveState = {
  curveAddress:
    Address;

  tokenAddress:
    Address;

  pairToken:
    Address;

  nativeQuote:
    boolean;

  quoteReserve:
    bigint;

  tokenReserve:
    bigint;

  reservedTokens:
    bigint;

  sellableTokens:
    bigint;

  feeBps:
    bigint;

  creatorTaxBps:
    bigint;

  graduated:
    boolean;
};


export type PonsV2BuyQuote = {
  quoteInRaw:
    bigint;

  quoteInEth:
    string;

  feeRaw:
    bigint;

  creatorTaxRaw:
    bigint;

  netQuoteInRaw:
    bigint;

  tokensOutRaw:
    bigint;

  actuallySpentRaw:
    bigint;

  actuallySpentEth:
    string;

  partialFill:
    boolean;
};


export type PonsV2SellQuote = {
  tokensInRaw:
    bigint;

  grossQuoteOutRaw:
    bigint;

  feeRaw:
    bigint;

  creatorTaxRaw:
    bigint;

  quoteOutRaw:
    bigint;

  quoteOutEth:
    string;
};


export type PonsV2RoundTripQuote = {
  state:
    PonsV2CurveState;

  buy:
    PonsV2BuyQuote;

  sell:
    PonsV2SellQuote;

  roiPercent:
    number;
};


async function rawRead(args: {
  address:
    Address;

  functionName:
    keyof typeof functionNames;
}): Promise<unknown> {
  const data =
    encodeFunctionData({
      abi:
        CURVE_ABI,

      functionName:
        args.functionName,
    } as never);


  const result =
    await robinhoodPublicClient
      .call({
        to:
          args.address,

        data,
      });


  if (
    !result.data
  ) {
    throw new Error(
      `No return data for ${args.functionName}`,
    );
  }


  return decodeFunctionResult({
    abi:
      CURVE_ABI,

    functionName:
      args.functionName,

    data:
      result.data as Hex,
  } as never);
}


const functionNames = {
  token:
    true,

  pairToken:
    true,

  getReserves:
    true,

  quoteReserve:
    true,

  tokenReserve:
    true,

  reservedTokens:
    true,

  sellableTokens:
    true,

  feeBps:
    true,

  creatorTaxBps:
    true,

  graduated:
    true,
} as const;


function ceilDiv(
  numerator:
    bigint,

  denominator:
    bigint,
): bigint {
  if (
    denominator <=
    0n
  ) {
    throw new Error(
      'Invalid denominator',
    );
  }


  return (
    numerator +
    denominator -
    1n
  ) /
    denominator;
}


/*
 * Exact Solidity equivalent of:
 *
 * amountInWithFee =
 *   amountIn * (10000 - feeBps)
 *
 * amountOut =
 *   amountInWithFee * reserveOut /
 *   (
 *     reserveIn * 10000 +
 *     amountInWithFee
 *   )
 *
 * PONS passes feeBps=0 to this helper
 * after separately removing fee + tax.
 */
export function getAmountOutRaw(args: {
  amountIn:
    bigint;

  reserveIn:
    bigint;

  reserveOut:
    bigint;

  feeBps?:
    bigint;
}): bigint {
  const feeBps =
    args.feeBps ??
    0n;


  if (
    args.amountIn <=
      0n ||
    args.reserveIn <=
      0n ||
    args.reserveOut <=
      0n ||
    feeBps >=
      BASIS_POINTS
  ) {
    return 0n;
  }


  const amountInWithFee =
    args.amountIn *
    (
      BASIS_POINTS -
      feeBps
    );


  const numerator =
    amountInWithFee *
    args.reserveOut;


  const denominator =
    args.reserveIn *
      BASIS_POINTS +
    amountInWithFee;


  if (
    denominator <=
    0n
  ) {
    return 0n;
  }


  return numerator /
    denominator;
}


/*
 * Exact Solidity equivalent of PONS
 * getAmountIn().
 */
export function getAmountInRaw(args: {
  amountOut:
    bigint;

  reserveIn:
    bigint;

  reserveOut:
    bigint;

  feeBps?:
    bigint;
}): bigint {
  const feeBps =
    args.feeBps ??
    0n;


  if (
    args.amountOut <=
      0n ||
    args.reserveIn <=
      0n ||
    args.reserveOut <=
      args.amountOut ||
    feeBps >=
      BASIS_POINTS
  ) {
    return 0n;
  }


  const numerator =
    args.amountOut *
    args.reserveIn *
    BASIS_POINTS;


  const denominator =
    (
      args.reserveOut -
      args.amountOut
    ) *
    (
      BASIS_POINTS -
      feeBps
    );


  if (
    denominator <=
    0n
  ) {
    return 0n;
  }


  return numerator /
    denominator +
    1n;
}


export async function getPonsV2CurveState(
  curveAddress:
    string,
): Promise<PonsV2CurveState> {
  const curve =
    getAddress(
      curveAddress,
    );


  const [
    tokenResult,
    pairTokenResult,
    reservesResult,
    reservedTokensResult,
    sellableTokensResult,
    feeBpsResult,
    creatorTaxBpsResult,
    graduatedResult,
  ] =
    await Promise.all([
      rawRead({
        address:
          curve,

        functionName:
          'token',
      }),

      rawRead({
        address:
          curve,

        functionName:
          'pairToken',
      }),

      rawRead({
        address:
          curve,

        functionName:
          'getReserves',
      }),

      rawRead({
        address:
          curve,

        functionName:
          'reservedTokens',
      }),

      rawRead({
        address:
          curve,

        functionName:
          'sellableTokens',
      }),

      rawRead({
        address:
          curve,

        functionName:
          'feeBps',
      }),

      rawRead({
        address:
          curve,

        functionName:
          'creatorTaxBps',
      }),

      rawRead({
        address:
          curve,

        functionName:
          'graduated',
      }),
    ]);


  const tokenAddress =
    getAddress(
      String(
        tokenResult,
      ),
    );


  const pairToken =
    getAddress(
      String(
        pairTokenResult,
      ),
    );


  const [
    quoteReserve,
    tokenReserve,
  ] =
    reservesResult as readonly [
      bigint,
      bigint,
    ];


  return {
    curveAddress:
      curve,

    tokenAddress,

    pairToken,

    nativeQuote:
      pairToken
        .toLowerCase() ===
      ZERO_ADDRESS
        .toLowerCase(),

    quoteReserve,

    tokenReserve,

    reservedTokens:
      reservedTokensResult as bigint,

    sellableTokens:
      sellableTokensResult as bigint,

    feeBps:
      feeBpsResult as bigint,

    creatorTaxBps:
      creatorTaxBpsResult as bigint,

    graduated:
      Boolean(
        graduatedResult,
      ),
  };
}


export function quotePonsV2Buy(args: {
  state:
    PonsV2CurveState;

  quoteInRaw:
    bigint;
}): PonsV2BuyQuote {
  const {
    state,
    quoteInRaw,
  } =
    args;


  if (
    !state.nativeQuote
  ) {
    throw new Error(
      'Curve does not use native ETH quote',
    );
  }


  if (
    state.graduated
  ) {
    throw new Error(
      'Curve already graduated',
    );
  }


  if (
    quoteInRaw <=
    0n
  ) {
    throw new Error(
      'Quote input must be positive',
    );
  }


  const combinedFeeBps =
    state.feeBps +
    state.creatorTaxBps;


  if (
    combinedFeeBps >=
    BASIS_POINTS
  ) {
    throw new Error(
      'Invalid combined curve fee',
    );
  }


  let spent =
    quoteInRaw;


  let fee =
    spent *
      state.feeBps /
    BASIS_POINTS;


  let tax =
    spent *
      state.creatorTaxBps /
    BASIS_POINTS;


  let net =
    spent -
    fee -
    tax;


  let tokensOut =
    getAmountOutRaw({
      amountIn:
        net,

      reserveIn:
        state.quoteReserve,

      reserveOut:
        state.tokenReserve,

      feeBps:
        0n,
    });


  let partialFill =
    false;


  /*
   * PONS clamps the final buy at the
   * remaining sellable allocation.
   */
  if (
    tokensOut >
    state.sellableTokens
  ) {
    if (
      state.sellableTokens <=
      0n
    ) {
      throw new Error(
        'No sellable tokens remain',
      );
    }


    partialFill =
      true;


    tokensOut =
      state.sellableTokens;


    const requiredNet =
      getAmountInRaw({
        amountOut:
          tokensOut,

        reserveIn:
          state.quoteReserve,

        reserveOut:
          state.tokenReserve,

        feeBps:
          0n,
      });


    /*
     * Solidity:
     *
     * ceil(
     *   net * 10000 /
     *   (10000 - feeBps - creatorTaxBps)
     * )
     */
    const grossRequired =
      ceilDiv(
        requiredNet *
          BASIS_POINTS,

        BASIS_POINTS -
          combinedFeeBps,
      );


    spent =
      grossRequired <
      quoteInRaw
        ? grossRequired
        : quoteInRaw;


    fee =
      spent *
        state.feeBps /
      BASIS_POINTS;


    tax =
      spent *
        state.creatorTaxBps /
      BASIS_POINTS;


    net =
      spent -
      fee -
      tax;
  }


  return {
    quoteInRaw,

    quoteInEth:
      formatEther(
        quoteInRaw,
      ),

    feeRaw:
      fee,

    creatorTaxRaw:
      tax,

    netQuoteInRaw:
      net,

    tokensOutRaw:
      tokensOut,

    actuallySpentRaw:
      spent,

    actuallySpentEth:
      formatEther(
        spent,
      ),

    partialFill,
  };
}


export function quotePonsV2Sell(args: {
  state:
    PonsV2CurveState;

  tokensInRaw:
    bigint;
}): PonsV2SellQuote {
  const {
    state,
    tokensInRaw,
  } =
    args;


  if (
    !state.nativeQuote
  ) {
    throw new Error(
      'Curve does not use native ETH quote',
    );
  }


  if (
    state.graduated
  ) {
    throw new Error(
      'Curve already graduated',
    );
  }


  if (
    tokensInRaw <=
    0n
  ) {
    throw new Error(
      'Token input must be positive',
    );
  }


  const grossQuoteOut =
    getAmountOutRaw({
      amountIn:
        tokensInRaw,

      reserveIn:
        state.tokenReserve,

      reserveOut:
        state.quoteReserve,

      feeBps:
        0n,
    });


  const fee =
    grossQuoteOut *
      state.feeBps /
    BASIS_POINTS;


  const tax =
    grossQuoteOut *
      state.creatorTaxBps /
    BASIS_POINTS;


  const quoteOut =
    grossQuoteOut -
    fee -
    tax;


  return {
    tokensInRaw,

    grossQuoteOutRaw:
      grossQuoteOut,

    feeRaw:
      fee,

    creatorTaxRaw:
      tax,

    quoteOutRaw:
      quoteOut,

    quoteOutEth:
      formatEther(
        quoteOut,
      ),
  };
}


/*
 * Diagnostic helper:
 *
 * "If I bought now with X ETH,
 * what would those tokens be worth
 * if immediately sold against the
 * same current curve state?"
 *
 * The outcome tracker will instead:
 *
 * - save tokensOut at entry
 * - fetch NEW curve state later
 * - value those same tokens at 5s etc.
 */
export async function simulatePonsV2RoundTrip(
  curveAddress:
    string,

  ethAmount:
    string = '0.01',
): Promise<PonsV2RoundTripQuote> {
  const state =
    await getPonsV2CurveState(
      curveAddress,
    );


  const quoteInRaw =
    parseEther(
      ethAmount,
    );


  const buy =
    quotePonsV2Buy({
      state,

      quoteInRaw,
    });


  /*
   * Approximate post-buy reserves so the
   * immediate sell diagnostic is realistic.
   *
   * Fees/tax are excluded from tradeable
   * quote reserve by getReserves(), so only
   * the net trading leg increases reserve.
   */
  const postBuyState:
    PonsV2CurveState = {
      ...state,

      quoteReserve:
        state.quoteReserve +
        buy.netQuoteInRaw,

      tokenReserve:
        state.tokenReserve -
        buy.tokensOutRaw,

      sellableTokens:
        state.sellableTokens >
        buy.tokensOutRaw
          ? state.sellableTokens -
            buy.tokensOutRaw
          : 0n,
  };


  const sell =
    quotePonsV2Sell({
      state:
        postBuyState,

      tokensInRaw:
        buy.tokensOutRaw,
    });


  const invested =
    Number(
      formatEther(
        buy.actuallySpentRaw,
      ),
    );


  const recovered =
    Number(
      formatEther(
        sell.quoteOutRaw,
      ),
    );


  const roiPercent =
    invested >
    0
      ? (
          (
            recovered -
            invested
          ) /
          invested
        ) *
        100
      : 0;


  return {
    state,
    buy,
    sell,
    roiPercent,
  };
}
