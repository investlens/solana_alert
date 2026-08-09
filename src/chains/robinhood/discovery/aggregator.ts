import {
  discoverFromDexScreener,
} from './sources/dexscreener.js';

import {
  discoverFromPons,
} from './launchpads/pons.js';

import type {
  RobinhoodDiscoveredToken,
  RobinhoodDiscoveryBatch,
} from './types.js';

export type RobinhoodDiscoveryResult = {
  discoveredAt: number;

  totalRaw: number;

  totalUnique: number;

  sources: {
    source: string;
    count: number;
  }[];

  tokens: RobinhoodDiscoveredToken[];
};

function normalizeAddress(
  address: string,
): string {
  return address
    .trim()
    .toLowerCase();
}

function mergeToken(
  existing: RobinhoodDiscoveredToken,
  incoming: RobinhoodDiscoveredToken,
): RobinhoodDiscoveredToken {
  const earliest =
    existing.discoveredAt <=
    incoming.discoveredAt
      ? existing
      : incoming;

  const sourceMap =
    new Map<string, typeof existing.sources[number]>();

  for (
    const evidence
    of [
      ...existing.sources,
      ...incoming.sources,
    ]
  ) {
    const key = [
      evidence.source,
      evidence.sourceId ?? '',
      evidence.pairAddress ?? '',
    ].join(':');

    if (!sourceMap.has(key)) {
      sourceMap.set(
        key,
        evidence,
      );
    }
  }

  return {
    ...existing,
    ...incoming,

    /*
     * Preserve original discovery source.
     */
    source:
      earliest.source,

    sourceType:
      earliest.sourceType,

    sourceId:
      earliest.sourceId,

    discoveredAt:
      Math.min(
        existing.discoveredAt,
        incoming.discoveredAt,
      ),

    sources:
      Array.from(
        sourceMap.values(),
      ),

    pairAddress:
      incoming.pairAddress ??
      existing.pairAddress,

    dexId:
      incoming.dexId ??
      existing.dexId,

    symbol:
      incoming.symbol ??
      existing.symbol,

    name:
      incoming.name ??
      existing.name,

    metadata: {
      ...(existing.metadata ?? {}),
      ...(incoming.metadata ?? {}),
    },
  };
}

export async function discoverRobinhoodEcosystem(
  limitPerSource = 50,
): Promise<RobinhoodDiscoveryResult> {
  const discoveredAt =
    Date.now();

  /*
   * Today:
   *
   * - DexScreener
   *
   * Next:
   *
   * - PONS
   * - generic on-chain pools
   * - RobinPad
   * - LaunchHood
   *
   * Those sources will be added here
   * without changing AlphaOS Core.
   */

  const settled =
  await Promise.allSettled([
    discoverFromDexScreener(
      limitPerSource,
    ),

    discoverFromPons(),
  ]);

  const batches:
    RobinhoodDiscoveryBatch[] =
      [];

  for (const result of settled) {
    if (
      result.status ===
      'fulfilled'
    ) {
      batches.push(
        result.value,
      );
    } else {
      console.error(
        '[RobinhoodAggregator] Source failed:',
        result.reason,
      );
    }
  }

  const tokenMap =
    new Map<
      string,
      RobinhoodDiscoveredToken
    >();

  let totalRaw = 0;

  for (const batch of batches) {
    totalRaw +=
      batch.tokens.length;

    for (const token of batch.tokens) {
      const key =
        normalizeAddress(
          token.tokenAddress,
        );

      const existing =
        tokenMap.get(key);

      if (!existing) {
        tokenMap.set(
          key,
          token,
        );

        continue;
      }

      tokenMap.set(
        key,
        mergeToken(
          existing,
          token,
        ),
      );
    }
  }

  return {
    discoveredAt,

    totalRaw,

    totalUnique:
      tokenMap.size,

    sources:
      batches.map(
        (batch) => ({
          source:
            batch.source,

          count:
            batch.tokens.length,
        }),
      ),

    tokens:
      Array.from(
        tokenMap.values(),
      ),
  };
}
