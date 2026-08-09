import {
  getAddress,
  type Address,
} from 'viem';

import {
  robinhoodPublicClient,
} from '../rpc.js';

import {
  getRobinhoodMarketSnapshot,
} from '../market.js';

export type RobinhoodPoolSecurityResult = {
  tokenAddress: Address;

  pairAddress: Address | null;

  poolBytecodeExists: boolean | null;

  marketIndexed: boolean;

  priceUsd: number | null;

  marketCapUsd: number | null;

  liquidityUsd: number | null;

  liquidityToMarketCapRatio:
    number | null;

  liquidityHealthy:
    boolean | null;

  warnings: string[];

  blockers: string[];

  scannedAt: number;
};

export async function scanRobinhoodPoolSecurity(args: {
  tokenAddress: string;

  pairAddress?: string | null;
}): Promise<RobinhoodPoolSecurityResult> {
  const tokenAddress =
    getAddress(
      args.tokenAddress,
    );

  const scannedAt =
    Date.now();

  const warnings:
    string[] = [];

  const blockers:
    string[] = [];

  let pairAddress:
    Address | null = null;

  let poolBytecodeExists:
    boolean | null = null;

  /*
   * If discovery already supplied a pool,
   * verify that the pool contract really
   * exists on Robinhood Chain.
   */
  if (args.pairAddress) {
    try {
      pairAddress =
        getAddress(
          args.pairAddress,
        );

      const poolCode =
        await robinhoodPublicClient
          .getCode({
            address:
              pairAddress,
          });

      poolBytecodeExists =
        Boolean(
          poolCode &&
          poolCode !== '0x',
        );

      if (!poolBytecodeExists) {
        blockers.push(
          'Discovered pool address has no contract bytecode',
        );
      }
    } catch (error) {
      warnings.push(
        `Pool verification failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  /*
   * DexScreener is enrichment only.
   *
   * A brand-new on-chain launch may not
   * have been indexed yet, so absence here
   * must NOT automatically block the token.
   */
  let market =
    null as Awaited<
      ReturnType<
        typeof getRobinhoodMarketSnapshot
      >
    >;

  try {
    market =
      await getRobinhoodMarketSnapshot(
        tokenAddress,
      );
  } catch (error) {
    warnings.push(
      `Market enrichment unavailable: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }

  if (!market) {
    warnings.push(
      'Token is not yet indexed by the market-data source',
    );

    return {
      tokenAddress,

      pairAddress,

      poolBytecodeExists,

      marketIndexed:
        false,

      priceUsd:
        null,

      marketCapUsd:
        null,

      liquidityUsd:
        null,

      liquidityToMarketCapRatio:
        null,

      liquidityHealthy:
        null,

      warnings,

      blockers,

      scannedAt,
    };
  }

  if (
    !pairAddress &&
    market.pairAddress
  ) {
    try {
      pairAddress =
        getAddress(
          market.pairAddress,
        );
    } catch {
      /*
       * Some DEX systems use pool identifiers
       * that are not ordinary addresses.
       */
    }
  }

  const marketCapUsd =
    market.marketCapUsd > 0
      ? market.marketCapUsd
      : null;

  const liquidityUsd =
    market.liquidityUsd > 0
      ? market.liquidityUsd
      : null;

  const liquidityToMarketCapRatio =
    marketCapUsd &&
    liquidityUsd
      ? liquidityUsd /
        marketCapUsd
      : null;

  /*
   * Initial observation threshold only.
   *
   * We will learn the correct Robinhood
   * ranges from outcomes instead of copying
   * Solana thresholds.
   */
  const liquidityHealthy =
    liquidityUsd == null
      ? null
      : liquidityUsd >= 5_000;

  if (
    liquidityUsd != null &&
    liquidityUsd < 5_000
  ) {
    warnings.push(
      `Low observed liquidity: $${liquidityUsd.toFixed(0)}`,
    );
  }

  if (
    liquidityToMarketCapRatio != null &&
    liquidityToMarketCapRatio < 0.05
  ) {
    warnings.push(
      `Low liquidity/market-cap ratio: ${(liquidityToMarketCapRatio * 100).toFixed(1)}%`,
    );
  }

  return {
    tokenAddress,

    pairAddress,

    poolBytecodeExists,

    marketIndexed:
      true,

    priceUsd:
      market.priceUsd,

    marketCapUsd,

    liquidityUsd,

    liquidityToMarketCapRatio,

    liquidityHealthy,

    warnings,

    blockers,

    scannedAt,
  };
}
