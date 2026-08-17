import {
  parseAbiItem,
  type Address,
} from 'viem';

import {
  PONS_CONTRACTS,
} from '../../ponsContracts.js';

import {
  robinhoodPublicClient,
} from '../../rpc.js';

import type {
  RobinhoodDiscoveryBatch,
  RobinhoodDiscoveredToken,
} from '../types.js';


const INITIAL_LOOKBACK_BLOCKS =
  2_000n;


/*
 * In-memory cursor.
 *
 * First cycle:
 *   scan recent 2,000 blocks
 *
 * Following cycles:
 *   scan only blocks created since
 *   the previous successful scan.
 *
 * Later we can persist this cursor
 * in Supabase so deploy/restart
 * continuity is also preserved.
 */
let lastScannedBlock:
  bigint | null = null;


const poolCreatedEvent =
  parseAbiItem(
    'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
  );


function normalize(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase();
}


function isWeth(
  address: string,
): boolean {
  return (
    normalize(address) ===
    normalize(
      PONS_CONTRACTS.weth,
    )
  );
}


function getCandidateToken(args: {
  token0: Address;
  token1: Address;
}): Address | null {
  /*
   * First production version:
   *
   * Focus on WETH-paired pools.
   *
   * This catches the type of freshly
   * tradeable token we actually care
   * about while avoiding arbitrary
   * token-token pool noise.
   */

  if (
    isWeth(
      args.token0,
    )
  ) {
    return args.token1;
  }


  if (
    isWeth(
      args.token1,
    )
  ) {
    return args.token0;
  }


  return null;
}


export async function discoverFromOnchain():
Promise<RobinhoodDiscoveryBatch> {
  const discoveredAt =
    Date.now();


  const latestBlock =
    await robinhoodPublicClient
      .getBlockNumber();


  let fromBlock:
    bigint;


  if (
    lastScannedBlock == null
  ) {
    fromBlock =
      latestBlock >
      INITIAL_LOOKBACK_BLOCKS
        ? latestBlock -
          INITIAL_LOOKBACK_BLOCKS
        : 0n;
  } else {
    fromBlock =
      lastScannedBlock +
      1n;
  }


  /*
   * Nothing new since previous scan.
   */
  if (
    fromBlock >
    latestBlock
  ) {
    return {
      source:
        'ONCHAIN',

      discoveredAt,

      tokens:
        [],
    };
  }


  console.log(
    '[RobinhoodOnchainDiscovery] Scanning:',
    {
      fromBlock:
        fromBlock.toString(),

      toBlock:
        latestBlock.toString(),
    },
  );


  const logs =
    await robinhoodPublicClient
      .getLogs({
        address:
          PONS_CONTRACTS
            .uniswapV3Factory,

        event:
          poolCreatedEvent,

        fromBlock,

        toBlock:
          latestBlock,
      });


  const tokenMap =
    new Map<
      string,
      RobinhoodDiscoveredToken
    >();


  for (
    const log
    of logs
  ) {
    const token0 =
      log.args.token0;

    const token1 =
      log.args.token1;

    const pool =
      log.args.pool;


    if (
      !token0 ||
      !token1 ||
      !pool
    ) {
      continue;
    }


    const candidateToken =
      getCandidateToken({
        token0,
        token1,
      });


    if (
      !candidateToken
    ) {
      continue;
    }


    /*
     * WETH itself must never become
     * a discovery candidate.
     */
    if (
      isWeth(
        candidateToken,
      )
    ) {
      continue;
    }


    const key =
      normalize(
        candidateToken,
      );


    const metadata = {
      token0,
      token1,

      pool,

      fee:
        log.args.fee
          ?.toString() ??
        null,

      tickSpacing:
        log.args.tickSpacing
          ?.toString() ??
        null,

      blockNumber:
        log.blockNumber
          ?.toString() ??
        null,

      transactionHash:
        log.transactionHash ??
        null,

      discoveryMethod:
        'UNISWAP_V3_POOL_CREATED',
    };


    tokenMap.set(
      key,
      {
        chain:
          'robinhood',

        tokenAddress:
          candidateToken,

        discoveredAt,

        source:
          'ONCHAIN',

        sourceType:
          'DEX_POOL',

        sourceId:
          log.transactionHash ??
          undefined,

        sources: [
          {
            source:
              'ONCHAIN',

            sourceType:
              'DEX_POOL',

            discoveredAt,

            sourceId:
              log.transactionHash ??
              undefined,

            pairAddress:
              pool,

            metadata,
          },
        ],

        pairAddress:
          pool,

        dexId:
          'uniswap',

        metadata,
      },
    );
  }


  /*
   * Only advance the cursor after
   * getLogs succeeded.
   *
   * If RPC throws, this assignment is
   * never reached and the range will
   * safely be retried next cycle.
   */
  lastScannedBlock =
    latestBlock;


  const tokens =
    Array.from(
      tokenMap.values(),
    );


  console.log(
    '[RobinhoodOnchainDiscovery] Pools found:',
    {
      rawLogs:
        logs.length,

      wethCandidates:
        tokens.length,
    },
  );


  return {
    source:
      'ONCHAIN',

    discoveredAt,

    tokens,
  };
}