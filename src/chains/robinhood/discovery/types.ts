export type RobinhoodDiscoverySource =
  | 'DEXSCREENER'
  | 'PONS'
  | 'ONCHAIN'
  | 'ROBINPAD'
  | 'LAUNCHHOOD'
  | 'FLAP'
  | 'OTHER';

export type RobinhoodDiscoverySourceType =
  | 'INDEXER'
  | 'LAUNCHPAD'
  | 'DEX_POOL'
  | 'ONCHAIN_CONTRACT';

export type RobinhoodDiscoveryEvidence = {
  source: RobinhoodDiscoverySource;

  sourceType:
    RobinhoodDiscoverySourceType;

  discoveredAt: number;

  sourceId?: string;

  pairAddress?: string;

  metadata?: Record<
    string,
    unknown
  >;
};

export type RobinhoodDiscoveredToken = {
  chain: 'robinhood';

  tokenAddress: string;

  /*
   * Earliest time AlphaOS discovered
   * this token from any source.
   */
  discoveredAt: number;

  /*
   * Primary/earliest source.
   *
   * Kept for convenient querying.
   */
  source:
    RobinhoodDiscoverySource;

  sourceType:
    RobinhoodDiscoverySourceType;

  sourceId?: string;

  /*
   * Complete discovery history.
   */
  sources:
    RobinhoodDiscoveryEvidence[];

  pairAddress?: string;

  dexId?: string;

  symbol?: string;

  name?: string;

  metadata?: Record<
    string,
    unknown
  >;
};

export type RobinhoodDiscoveryBatch = {
  source:
    RobinhoodDiscoverySource;

  discoveredAt: number;

  tokens:
    RobinhoodDiscoveredToken[];
};
