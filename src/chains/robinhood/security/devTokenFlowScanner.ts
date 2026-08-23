import {
  getAddress,
  type Address,
} from 'viem';

import {
  robinhoodChain,
} from '../config.js';

import {
  getPonsLaunchState,
} from '../ponsLaunchState.js';

import {
  supabase,
} from '../../../services/supabase.js';

const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000';

const DEAD_ADDRESS =
  '0x000000000000000000000000000000000000dEaD';

export function classifyDevTransferDestination(destination: string): 'BURN' | 'TRANSFER' {
  const normalized = destination.toLowerCase();
  return normalized === ZERO_ADDRESS.toLowerCase() || normalized === DEAD_ADDRESS.toLowerCase()
    ? 'BURN'
    : 'TRANSFER';
}

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const BALANCE_OF =
  '0x70a08231';

const TOTAL_SUPPLY =
  '0x18160ddd';

export type DevTokenFlowResult = {
  tokenAddress: Address;
  deployerAddress: Address | null;

  devHoldingPercent:
    number | null;

  totalBurnPercent:
    number | null;

  confirmedDevBurnPercent:
    number | null;

  otherDevTransferPercent:
    number | null;

  evidenceStatus:
    'COMPLETE'
    | 'BALANCES_ONLY'
    | 'UNAVAILABLE';

  scannedAt: number;
};

function getRpcUrl(): string {
  const url =
    robinhoodChain
      .rpcUrls
      .default
      .http[0];

  if (!url) {
    throw new Error(
      'Robinhood RPC unavailable',
    );
  }

  return url;
}

async function rpc<T>(
  method: string,
  params: unknown[],
): Promise<T> {
  const response =
    await fetch(
      getRpcUrl(),
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
          }),
      },
    );

  if (!response.ok) {
    throw new Error(
      `RPC HTTP ${response.status}`,
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
      `${method} failed`,
    );
  }

  if (
    payload.result ===
    undefined
  ) {
    throw new Error(
      `${method} returned no result`,
    );
  }

  return payload.result;
}

function toBigInt(
  value:
    string |
    null |
    undefined,
): bigint | null {
  if (
    !value ||
    value === '0x'
  ) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function percent(
  value: bigint | null,
  total: bigint | null,
): number | null {
  if (
    value == null ||
    total == null ||
    total <= 0n
  ) {
    return null;
  }

  return (
    Number(
      value *
      1_000_000n /
      total,
    ) /
    10_000
  );
}

function addressArgument(
  address: string,
): string {
  return (
    address
      .toLowerCase()
      .replace(/^0x/, '')
      .padStart(64, '0')
  );
}

function balanceOfData(
  address: string,
): string {
  return (
    BALANCE_OF +
    addressArgument(address)
  );
}

function addressTopic(
  address: string,
): string {
  return (
    '0x' +
    addressArgument(address)
  );
}

async function ethCall(
  token: Address,
  data: string,
): Promise<bigint | null> {
  const result =
    await rpc<string>(
      'eth_call',
      [
        {
          to: token,
          data,
        },
        'latest',
      ],
    );

  return toBigInt(result);
}

type RpcLog = {
  data?: string;
  topics?: string[];
};

async function scanRecentDevTransfers(
  token: Address,
  deployer: Address,
): Promise<{
  burned: bigint;
  transferred: bigint;
}> {
  const latestHex =
    await rpc<string>(
      'eth_blockNumber',
      [],
    );

  const latest =
    BigInt(latestHex);

  const lookback =
    20_000n;

  const fromBlock =
    latest > lookback
      ? latest - lookback
      : 0n;

  const logs =
    await rpc<RpcLog[]>(
      'eth_getLogs',
      [
        {
          address: token,

          fromBlock:
            `0x${fromBlock.toString(16)}`,

          toBlock:
            'latest',

          topics: [
            TRANSFER_TOPIC,
            addressTopic(deployer),
          ],
        },
      ],
    );

  let burned =
    0n;

  let transferred =
    0n;

  for (
    const log
    of logs
  ) {
    if (
      !log.topics ||
      log.topics.length < 3
    ) {
      continue;
    }

    const destination =
      `0x${log.topics[2].slice(-40)}`
        .toLowerCase();

    const amount =
      toBigInt(log.data) ??
      0n;

    if (
      amount <= 0n
    ) {
      continue;
    }

    if (classifyDevTransferDestination(destination) === 'BURN') {
      burned += amount;
    } else {
      transferred += amount;
    }
  }

  return {
    burned,
    transferred,
  };
}

async function resolvePonsDeployer(
  token: Address,
): Promise<{
  deployer: Address | null;
  source:
    | 'PONS_V1_FACTORY'
    | 'PONS_SHADOW_V2'
    | 'UNKNOWN';
}> {
  /*
   * PONS V1:
   * canonical factory state.
   */
  try {
    const launch =
      await getPonsLaunchState(
        token,
      );

    if (
      launch.exists &&
      launch.deployer
    ) {
      return {
        deployer:
          getAddress(
            launch.deployer,
          ),

        source:
          'PONS_V1_FACTORY',
      };
    }
  } catch {
    /*
     * Do not fail here.
     * V2 tokens are not represented by the V1 factory.
     */
  }

  /*
   * PONS V2:
   *
   * The live-emitter scanner already decodes and persists
   * the launch deployer in pons_shadow_trades.
   *
   * Reuse that verified intelligence instead of performing
   * another independent launch-discovery implementation.
   */
  try {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          'pons_shadow_trades',
        )
        .select(
          'deployer_address,launch_version,detected_at',
        )
        .eq(
          'token_address',
          token.toLowerCase(),
        )
        .not(
          'deployer_address',
          'is',
          null,
        )
        .order(
          'detected_at',
          {
            ascending:
              false,
          },
        )
        .limit(
          1,
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (
      data?.deployer_address
    ) {
      return {
        deployer:
          getAddress(
            data.deployer_address,
          ),

        source:
          'PONS_SHADOW_V2',
      };
    }
  } catch (
    error
  ) {
    console.warn(
      '[DevTokenFlow] Shadow deployer lookup failed:',
      {
        token,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );
  }

  return {
    deployer:
      null,

    source:
      'UNKNOWN',
  };
}

export async function
scanRobinhoodDevTokenFlow(
  tokenAddress: string,
): Promise<DevTokenFlowResult> {
  const token =
    getAddress(
      tokenAddress,
    );

  const empty:
    DevTokenFlowResult = {
      tokenAddress: token,
      deployerAddress: null,

      devHoldingPercent: null,
      totalBurnPercent: null,
      confirmedDevBurnPercent: null,
      otherDevTransferPercent: null,

      evidenceStatus:
        'UNAVAILABLE',

      scannedAt:
        Date.now(),
    };

  try {
    const deployerResolution =
      await resolvePonsDeployer(
        token,
      );

    if (
      !deployerResolution.deployer
    ) {
      console.log(
        '[DevTokenFlow] Deployer unavailable:',
        {
          token,
        },
      );

      return empty;
    }

    const deployer =
      deployerResolution.deployer;

    console.log(
      '[DevTokenFlow] Deployer resolved:',
      {
        token,

        deployer,

        source:
          deployerResolution.source,
      },
    );

    const [
      totalSupply,
      devBalance,
      deadBalance,
      zeroBalance,
    ] =
      await Promise.all([
        ethCall(
          token,
          TOTAL_SUPPLY,
        ),

        ethCall(
          token,
          balanceOfData(
            deployer,
          ),
        ),

        ethCall(
          token,
          balanceOfData(
            DEAD_ADDRESS,
          ),
        ),

        ethCall(
          token,
          balanceOfData(
            ZERO_ADDRESS,
          ),
        ),
      ]);

    const totalBurn =
      (
        deadBalance ??
        0n
      ) +
      (
        zeroBalance ??
        0n
      );

    const base:
      DevTokenFlowResult = {
        ...empty,

        deployerAddress:
          deployer,

        devHoldingPercent:
          percent(
            devBalance,
            totalSupply,
          ),

        totalBurnPercent:
          percent(
            totalBurn,
            totalSupply,
          ),

        evidenceStatus:
          'BALANCES_ONLY',
      };

    try {
      const movement =
        await scanRecentDevTransfers(
          token,
          deployer,
        );

      return {
        ...base,

        confirmedDevBurnPercent:
          percent(
            movement.burned,
            totalSupply,
          ),

        otherDevTransferPercent:
          percent(
            movement.transferred,
            totalSupply,
          ),

        evidenceStatus:
          'COMPLETE',
      };
    } catch (error) {
      console.log(
        '[DevTokenFlow] Transfer scan unavailable:',
        error instanceof Error
          ? error.message
          : String(error),
      );

      return base;
    }
  } catch (error) {
    console.log(
      '[DevTokenFlow] Scan unavailable:',
      error instanceof Error
        ? error.message
        : String(error),
    );

    return empty;
  }
}
