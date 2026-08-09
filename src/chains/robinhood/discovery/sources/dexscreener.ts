import {
  discoverRobinhoodCandidates,
} from '../../discovery.js';

import type {
  RobinhoodDiscoveryBatch,
  RobinhoodDiscoveredToken,
} from '../types.js';

export async function discoverFromDexScreener(
  limit = 50,
): Promise<RobinhoodDiscoveryBatch> {
  const discoveredAt =
    Date.now();

  const candidates =
    await discoverRobinhoodCandidates(
      limit,
    );

  const tokens:
    RobinhoodDiscoveredToken[] =
      candidates.map(
        (candidate) => {
          const evidence = {
            source:
              'DEXSCREENER' as const,

            sourceType:
              'INDEXER' as const,

            discoveredAt,

            pairAddress:
              candidate.pairAddress,

            metadata: {
              discoverySource:
                candidate.source,

              marketCapUsd:
                candidate.marketCapUsd,

              liquidityUsd:
                candidate.liquidityUsd,

              volume5mUsd:
                candidate.volume5mUsd,

              buys5m:
                candidate.buys5m,

              sells5m:
                candidate.sells5m,

              buyRatio:
                candidate.buyRatio,

              activityScore:
                candidate.activityScore,
            },
          };

          return {
            chain:
              'robinhood',

            tokenAddress:
              candidate.tokenAddress,

            discoveredAt,

            source:
              'DEXSCREENER',

            sourceType:
              'INDEXER',

            sources: [
              evidence,
            ],

            pairAddress:
              candidate.pairAddress,

            dexId:
              candidate.dexId,

            symbol:
              candidate.symbol,

            name:
              candidate.name,

            metadata:
              evidence.metadata,
          };
        },
      );

  return {
    source:
      'DEXSCREENER',

    discoveredAt,

    tokens,
  };
}
