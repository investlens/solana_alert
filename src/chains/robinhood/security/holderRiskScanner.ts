import {
  getAddress,
  type Address,
} from 'viem';

import {
  getRobinhoodTokenMetadata,
  type RobinhoodTokenMetadata,
} from '../tokenMetadata.js';

import {
  PONS_CONTRACTS,
} from '../ponsContracts.js';

const BLOCKSCOUT_BASE =
  'https://robinhoodchain.blockscout.com';

const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000';

const DEAD_ADDRESS =
  '0x000000000000000000000000000000000000dEaD';

type HolderAddressInfo = {
  hash?: string;
  is_contract?: boolean;
  name?: string | null;
};

type HolderRow = {
  value?: string;

  address_hash?: HolderAddressInfo;

  address?: HolderAddressInfo;
};

type HolderResponse = {
  items?: HolderRow[];
};

export type RobinhoodHolderRiskResult = {
  tokenAddress: Address;

  holderCountObserved: number;

  excludedHolderCount: number;

  circulatingHolderCountObserved: number;

  top1Pct: number | null;

  top5Pct: number | null;

  top10Pct: number | null;

  top1Wallet:
    string | null;

  sampledWallets: string[];

  concentrationRisk:
    'LOW'
    | 'MEDIUM'
    | 'HIGH'
    | 'UNKNOWN';

  warnings: string[];

  excludedAddresses: {
    address: string;
    reason: string;
    pctOfSupply: number;
  }[];

  scannedAt: number;
};

function percentage(
  amount: bigint,
  total: bigint,
): number {
  if (total <= 0n) {
    return 0;
  }

  return (
    Number(
      amount *
        1_000_000n /
        total,
    ) /
    10_000
  );
}

function getHolderAddress(
  row: HolderRow,
): string | null {
  return (
    row.address_hash?.hash ??
    row.address?.hash ??
    null
  );
}

function isContractHolder(
  row: HolderRow,
): boolean {
  return (
    row.address_hash
      ?.is_contract ??
    row.address
      ?.is_contract ??
    false
  );
}

function normalized(
  value:
    string | undefined,
): string {
  return (
    value ??
    ''
  ).toLowerCase();
}

export async function scanRobinhoodHolderRisk(
  tokenAddress: string,
  options: {
    poolAddress?: string | null;
    metadata?: RobinhoodTokenMetadata;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<RobinhoodHolderRiskResult> {
  const address =
    getAddress(
      tokenAddress,
    );

  const warnings:
    string[] = [];

  const metadata = options.metadata ?? await getRobinhoodTokenMetadata(address, { signal: options.signal });

  if (
    metadata.totalSupplyRaw == null ||
    metadata.totalSupplyRaw <= 0n
  ) {
    return {
      tokenAddress:
        address,

      holderCountObserved:
        0,

      excludedHolderCount:
        0,

      circulatingHolderCountObserved:
        0,

      top1Pct:
        null,

      top5Pct:
        null,

      top10Pct:
        null,

      top1Wallet:
        null,

      sampledWallets: [],

      concentrationRisk:
        'UNKNOWN',

      warnings: [
        'Total supply unavailable',
      ],

      excludedAddresses: [],

      scannedAt:
        Date.now(),
    };
  }

  const url =
    `${BLOCKSCOUT_BASE}/api/v2/tokens/` +
    `${address}/holders`;

  let response:
    Response;

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), options.timeoutMs ?? 2_750);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  try {
    response =
      await fetch(
        url,
        {
          headers: {
            Accept:
              'application/json',
          },
          signal,
        },
      );
  } catch (error) {
    return {
      tokenAddress:
        address,

      holderCountObserved:
        0,

      excludedHolderCount:
        0,

      circulatingHolderCountObserved:
        0,

      top1Pct:
        null,

      top5Pct:
        null,

      top10Pct:
        null,

      top1Wallet:
        null,

      sampledWallets: [],

      concentrationRisk:
        'UNKNOWN',

      warnings: [
        `Holder API unavailable: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      ],

      excludedAddresses: [],

      scannedAt:
        Date.now(),
    };
  } finally { clearTimeout(timeout); }

  if (!response.ok) {
    return {
      tokenAddress:
        address,

      holderCountObserved:
        0,

      excludedHolderCount:
        0,

      circulatingHolderCountObserved:
        0,

      top1Pct:
        null,

      top5Pct:
        null,

      top10Pct:
        null,

      top1Wallet:
        null,

      sampledWallets: [],

      concentrationRisk:
        'UNKNOWN',

      warnings: [
        `Blockscout holders HTTP ${response.status}`,
      ],

      excludedAddresses: [],

      scannedAt:
        Date.now(),
    };
  }

  const payload =
    await response.json() as
      HolderResponse;

  const rows =
    Array.isArray(
      payload.items,
    )
      ? payload.items
      : [];

  const holders =
    rows
      .map((row) => {
        const holder =
          getHolderAddress(
            row,
          );

        let value =
          0n;

        try {
          value =
            BigInt(
              row.value ??
              '0',
            );
        } catch {
          value =
            0n;
        }

        return {
          address:
            holder,

          value,

          isContract:
            isContractHolder(
              row,
            ),
        };
      })
      .filter(
        (holder) =>
          holder.address &&
          holder.value > 0n,
      )
      .sort(
        (a, b) =>
          a.value === b.value
            ? 0
            : a.value > b.value
              ? -1
              : 1,
      );

  const excludedMap =
    new Map<
      string,
      string
    >();

  if (
    options.poolAddress
  ) {
    excludedMap.set(
      normalized(
        options.poolAddress,
      ),
      'LIQUIDITY_POOL',
    );
  }

  excludedMap.set(
    normalized(
      PONS_CONTRACTS.locker,
    ),
    'PONS_LOCKER',
  );

  excludedMap.set(
    normalized(
      PONS_CONTRACTS.positionManager,
    ),
    'POSITION_MANAGER',
  );

  excludedMap.set(
    normalized(
      ZERO_ADDRESS,
    ),
    'ZERO_ADDRESS',
  );

  excludedMap.set(
    normalized(
      DEAD_ADDRESS,
    ),
    'BURN_ADDRESS',
  );

  const excludedAddresses:
    RobinhoodHolderRiskResult[
      'excludedAddresses'
    ] =
      [];

  const circulating =
    [];

  for (
    const holder
    of holders
  ) {
    const holderKey =
      normalized(
        holder.address ??
        '',
      );

    const exclusionReason =
      excludedMap.get(
        holderKey,
      );

    if (exclusionReason) {
      excludedAddresses.push({
        address:
          holder.address!,

        reason:
          exclusionReason,

        pctOfSupply:
          percentage(
            holder.value,
            metadata.totalSupplyRaw,
          ),
      });

      continue;
    }

    circulating.push(
      holder,
    );
  }

  const top1 =
    circulating
      .slice(
        0,
        1,
      )
      .reduce(
        (
          sum,
          holder,
        ) =>
          sum +
          holder.value,
        0n,
      );

  const top5 =
    circulating
      .slice(
        0,
        5,
      )
      .reduce(
        (
          sum,
          holder,
        ) =>
          sum +
          holder.value,
        0n,
      );

  const top10 =
    circulating
      .slice(
        0,
        10,
      )
      .reduce(
        (
          sum,
          holder,
        ) =>
          sum +
          holder.value,
        0n,
      );

  const top1Pct =
    percentage(
      top1,
      metadata.totalSupplyRaw,
    );

  const top5Pct =
    percentage(
      top5,
      metadata.totalSupplyRaw,
    );

  const top10Pct =
    percentage(
      top10,
      metadata.totalSupplyRaw,
    );

  let concentrationRisk:
    RobinhoodHolderRiskResult[
      'concentrationRisk'
    ] =
      'LOW';

  /*
   * Observation thresholds only.
   *
   * We'll calibrate these from
   * Robinhood outcomes later.
   */
  if (
    top1Pct >= 25 ||
    top5Pct >= 50
  ) {
    concentrationRisk =
      'HIGH';

    warnings.push(
      'High circulating-wallet concentration',
    );
  } else if (
    top1Pct >= 12 ||
    top5Pct >= 30
  ) {
    concentrationRisk =
      'MEDIUM';

    warnings.push(
      'Elevated circulating-wallet concentration',
    );
  }

  /*
   * Very small holder samples should
   * not receive excessive confidence.
   */
  if (
    circulating.length <
    5
  ) {
    warnings.push(
      'Very small circulating holder sample',
    );

    if (
      concentrationRisk ===
      'LOW'
    ) {
      concentrationRisk =
        'UNKNOWN';
    }
  }

  return {
    tokenAddress:
      address,

    holderCountObserved:
      holders.length,

    excludedHolderCount:
      excludedAddresses.length,

    circulatingHolderCountObserved:
      circulating.length,

    top1Pct,

    top5Pct,

    top10Pct,

    top1Wallet:
      circulating[0]
        ?.address ??
      null,

    sampledWallets: circulating
      .filter(holder => !holder.isContract)
      .slice(0, 20)
      .map(holder => holder.address!),

    concentrationRisk,

    warnings,

    excludedAddresses,

    scannedAt:
      Date.now(),
  };
}
