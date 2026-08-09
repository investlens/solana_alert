import {
  parseAbiItem,
} from 'viem';

import {
  getRobinhoodTokenMetadata,
} from '../../tokenMetadata.js';

import {
  robinhoodPublicClient,
} from '../../rpc.js';

import type {
  RobinhoodDiscoveryBatch,
  RobinhoodDiscoveredToken,
} from '../types.js';

const PONS_ACTIVE_FACTORY =
  '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB' as const;

const PONS_ACTIVE_FACTORY_START_BLOCK =
  8_991_118n;

/*
 * Don't scan the entire factory history every cycle.
 *
 * The first live implementation looks backwards over a
 * bounded recent block range. Later we'll persist a cursor
 * so every block is processed exactly once.
 */
const DEFAULT_LOOKBACK_BLOCKS =
  2_000n;

const tokenLaunchedEvent =
  parseAbiItem(
    'event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)',
  );

export async function discoverFromPons(
  lookbackBlocks:
    bigint = DEFAULT_LOOKBACK_BLOCKS,
): Promise<RobinhoodDiscoveryBatch> {
  const discoveredAt =
    Date.now();

  const latestBlock =
    await robinhoodPublicClient
      .getBlockNumber();

  const requestedFromBlock =
    latestBlock > lookbackBlocks
      ? latestBlock -
        lookbackBlocks
      : PONS_ACTIVE_FACTORY_START_BLOCK;

  const fromBlock =
    requestedFromBlock <
    PONS_ACTIVE_FACTORY_START_BLOCK
      ? PONS_ACTIVE_FACTORY_START_BLOCK
      : requestedFromBlock;

  console.log(
    '[PonsDiscovery] Scanning:',
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
          PONS_ACTIVE_FACTORY,

        event:
          tokenLaunchedEvent,

        fromBlock,

        toBlock:
          latestBlock,
      });

  const tokens:
    RobinhoodDiscoveredToken[] =
      [];

  for (const log of logs) {
    const args =
      log.args;

    const tokenAddress =
      args.token;

    if (!tokenAddress) {
      continue;
    }

    let tokenMetadata:
      Awaited<
        ReturnType<
          typeof getRobinhoodTokenMetadata
        >
      > | null = null;

    try {
      tokenMetadata =
        await getRobinhoodTokenMetadata(
          tokenAddress,
        );
    } catch (error) {
      console.error(
        '[PonsDiscovery] Metadata enrichment failed:',
        {
          token:
            tokenAddress,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    }

    const metadata = {

      tokenDecimals:
        tokenMetadata?.decimals ??
        null,

      totalSupplyRaw:
        tokenMetadata
          ?.totalSupplyRaw
          ?.toString() ??
        null,

      bytecodeExists:
        tokenMetadata?.bytecodeExists ??
        false,

      metadataReadErrors:
        tokenMetadata?.readErrors ??
        [],

      deployer:
        args.deployer,

      dexFactory:
        args.dexFactory,

      pairToken:
        args.pairToken,

      dexId:
        args.dexId?.toString(),

      launchConfigId:
        args.launchConfigId
          ?.toString(),

      positionId:
        args.positionId
          ?.toString(),

      restrictionsEndBlock:
        args.restrictionsEndBlock
          ?.toString(),

      initialBuyAmount:
        args.initialBuyAmount
          ?.toString(),

      blockNumber:
        log.blockNumber
          ?.toString(),

      transactionHash:
        log.transactionHash,
    };

    tokens.push({
      symbol:
        tokenMetadata?.symbol ??
        undefined,

      name:
        tokenMetadata?.name ??
        undefined,

      chain:
        'robinhood',

      tokenAddress,

      discoveredAt,

      source:
        'PONS',

      sourceType:
        'LAUNCHPAD',

      sourceId:
        log.transactionHash ??
        undefined,

      sources: [
        {
          source:
            'PONS',

          sourceType:
            'LAUNCHPAD',

          discoveredAt,

          sourceId:
            log.transactionHash ??
            undefined,

          pairAddress:
            args.pool,

          metadata,
        },
      ],

      pairAddress:
        args.pool,

      dexId:
        'uniswap',

      metadata,
    });
  }

  console.log(
    '[PonsDiscovery] Launches found:',
    tokens.length,
  );

  return {
    source:
      'PONS',

    discoveredAt,

    tokens,
  };
}
