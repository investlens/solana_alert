import {
  decodeEventLog,
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


const ERC20_TRANSFER_ABI =
  parseAbi([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);


export type RobinhoodDevMovementResult = {
  tokenAddress: Address;

  deployerAddress:
    Address | null;

  moved:
    boolean;

  sold:
    boolean;

  burned:
    boolean;

  transferCount:
    number;

  totalMovedRaw:
    bigint;

  movedPercentOfSupply:
    number | null;

  destinations:
    Address[];

  status:
    | 'NO_MOVEMENT'
    | 'DEV_MOVED'
    | 'DEV_SOLD'
    | 'UNKNOWN';

  warnings:
    string[];

  scannedAt:
    number;
};


async function rpcRequest<T>(
  method: string,
  params: unknown[],
): Promise<T> {
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

            method,

            params,
          }),
      },
    );

  if (!response.ok) {
    throw new Error(
      `Robinhood RPC HTTP ${response.status}`,
    );
  }

  const payload =
    await response.json() as {
      result?: T;

      error?: {
        message?: string;
      };
    };

  if (payload.error) {
    throw new Error(
      payload.error.message ??
      `Robinhood RPC ${method} failed`,
    );
  }

  return payload.result as T;
}


async function getLatestBlockNumber():
Promise<bigint> {
  const result =
    await rpcRequest<Hex>(
      'eth_blockNumber',
      [],
    );

  return BigInt(
    result,
  );
}


function toBlockHex(
  block: bigint,
): Hex {
  return (
    '0x' +
    block.toString(16)
  ) as Hex;
}


export async function scanRobinhoodDevMovement(
  tokenAddress: string,
): Promise<RobinhoodDevMovementResult> {
  const token =
    getAddress(
      tokenAddress,
    );

  const warnings:
    string[] = [];

  try {
    const launch =
      await getPonsLaunchState(
        token,
      );

    if (!launch.exists) {
      return {
        tokenAddress:
          token,

        deployerAddress:
          null,

        moved:
          false,

        sold:
          false,

        burned:
          false,

        transferCount:
          0,

        totalMovedRaw:
          0n,

        movedPercentOfSupply:
          null,

        destinations:
          [],

        status:
          'UNKNOWN',

        warnings: [
          'PONS deployer could not be verified',
        ],

        scannedAt:
          Date.now(),
      };
    }


    const deployer =
      getAddress(
        launch.deployer,
      );

    const latestBlock =
      await getLatestBlockNumber();


    /*
     * Scan a bounded recent block range.
     *
     * This is enough for newly launched PONS
     * tokens while avoiding an expensive full-chain
     * history scan.
     */
    const lookbackBlocks =
      10_000n;

    const fromBlock =
      latestBlock >
      lookbackBlocks
        ? latestBlock -
          lookbackBlocks
        : 0n;


    const transferTopic =
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';


    const deployerTopic =
      (
        '0x' +
        deployer
          .slice(2)
          .toLowerCase()
          .padStart(
            64,
            '0',
          )
      ) as Hex;


    const logs =
      await rpcRequest<
        Array<{
          address: Address;
          topics: Hex[];
          data: Hex;
          transactionHash: Hex;
        }>
      >(
        'eth_getLogs',
        [
          {
            address:
              token,

            fromBlock:
              toBlockHex(
                fromBlock,
              ),

            toBlock:
              'latest',

            topics: [
              transferTopic,

              deployerTopic,
            ],
          },
        ],
      );


    let totalMovedRaw =
      0n;

    const destinations =
      new Set<Address>();


    for (const log of logs) {
      try {
        const decoded =
          decodeEventLog({
            abi:
              ERC20_TRANSFER_ABI,

            eventName:
              'Transfer',

            topics:
                log.topics as [
                    Hex,
                    ...Hex[],
                ],

                data:
                log.data,
          });

        const from =
          getAddress(
            decoded.args.from,
          );

        const to =
          getAddress(
            decoded.args.to,
          );

        const value =
          decoded.args.value;

        if (
          from.toLowerCase() !==
          deployer.toLowerCase()
        ) {
          continue;
        }

        if (
          value <= 0n
        ) {
          continue;
        }

        totalMovedRaw +=
          value;

        destinations.add(
          to,
        );
      } catch (error) {
        warnings.push(
          'Could not decode one dev transfer log',
        );
      }
    }


    if (
      totalMovedRaw <= 0n
    ) {
      return {
        tokenAddress:
          token,

        deployerAddress:
          deployer,

        moved:
          false,

        sold:
          false,

        burned:
          false,

        transferCount:
          0,

        totalMovedRaw:
          0n,

        movedPercentOfSupply:
          0,

        destinations:
          [],

        status:
          'NO_MOVEMENT',

        warnings,

        scannedAt:
          Date.now(),
      };
    }


    /*
     * V1 classification:
     *
     * Any outbound token transfer from the
     * deployer is considered unsafe.
     *
     * We intentionally classify this as
     * DEV_MOVED rather than guessing whether
     * the destination is definitely a router/pool.
     *
     * Later we can enrich destinations and
     * promote certain transfers to DEV_SOLD.
     */
    const burnDestinations = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);
    const burned = destinations.size > 0 && [...destinations].every(destination => burnDestinations.has(destination.toLowerCase()));
    const movedPercentOfSupply = launch.supply > 0n ? Number(totalMovedRaw * 1_000_000n / launch.supply) / 10_000 : null;
    return {
      tokenAddress:
        token,

      deployerAddress:
        deployer,

      moved:
        true,

      sold:
        false,

      burned,

      transferCount:
        logs.length,

      totalMovedRaw,

      movedPercentOfSupply,

      destinations:
        Array.from(
          destinations,
        ),

      status:
        'DEV_MOVED',

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

      moved:
        false,

      sold:
        false,

      burned:
        false,

      transferCount:
        0,

      totalMovedRaw:
        0n,

      movedPercentOfSupply:
        null,

      destinations:
        [],

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
