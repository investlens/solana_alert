import {
  parseAbiItem,
} from 'viem';

import {
  getRobinhoodTokenMetadata,
} from '../../tokenMetadata.js';

import {
  getRobinhoodBlockNumberResilient,
  getRobinhoodLogsResilient,
} from '../../rpc.js';
import { rememberAuthoritativePonsToken } from '../../launchSecurity.js';

import type {
  RobinhoodDiscoveryBatch,
  RobinhoodDiscoveredToken,
} from '../types.js';

const PONS_ACTIVE_FACTORY =
  '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as const;

const PONS_ACTIVE_FACTORY_START_BLOCK =
  27_027_321n;

const DEFAULT_LOOKBACK_BLOCKS =
  2_000n;

const tokenLaunchedEvent =
  parseAbiItem(
    'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
  );

export async function discoverFromPons(
  lookbackBlocks:
    bigint = DEFAULT_LOOKBACK_BLOCKS,
): Promise<RobinhoodDiscoveryBatch> {
  const discoveredAt = Date.now();
  const latestBlock = await getRobinhoodBlockNumberResilient();
  const requestedFromBlock = latestBlock > lookbackBlocks ? latestBlock - lookbackBlocks : PONS_ACTIVE_FACTORY_START_BLOCK;
  const fromBlock = requestedFromBlock < PONS_ACTIVE_FACTORY_START_BLOCK ? PONS_ACTIVE_FACTORY_START_BLOCK : requestedFromBlock;

  console.log('[PonsDiscovery] Scanning:', {
    factory: 'v2-current',
    fromBlock: fromBlock.toString(),
    toBlock: latestBlock.toString(),
  });

  const logs = await getRobinhoodLogsResilient({
    address: PONS_ACTIVE_FACTORY,
    event: tokenLaunchedEvent,
    fromBlock,
    toBlock: latestBlock,
  });

  const tokens: RobinhoodDiscoveredToken[] = [];

  for (const rawLog of logs) {
    const log = rawLog as any;
    const args = log.args;
    const tokenAddress = args.token;
    if (!tokenAddress) continue;

    // The factory log itself is authoritative PONS lineage. Seed this before
    // any database access so a Supabase outage cannot downgrade the token to CUSTOM.
    rememberAuthoritativePonsToken(tokenAddress);

    let tokenMetadata: Awaited<ReturnType<typeof getRobinhoodTokenMetadata>> | null = null;
    try {
      tokenMetadata = await getRobinhoodTokenMetadata(tokenAddress);
    } catch (error) {
      console.error('[PonsDiscovery] Metadata enrichment failed:', {
        token: tokenAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const metadata = {
      tokenDecimals: tokenMetadata?.decimals ?? null,
      totalSupplyRaw: tokenMetadata?.totalSupplyRaw?.toString() ?? null,
      bytecodeExists: tokenMetadata?.bytecodeExists ?? false,
      metadataReadErrors: tokenMetadata?.readErrors ?? [],
      deployer: args.deployer,
      curve: args.curve,
      pairToken: args.pairToken,
      launchConfigId: args.launchConfigId?.toString(),
      graduationThreshold: args.graduationThreshold?.toString(),
      blockNumber: log.blockNumber?.toString(),
      transactionHash: log.transactionHash,
      factoryVersion: 'v2-current',
    };

    tokens.push({
      symbol: tokenMetadata?.symbol ?? undefined,
      name: tokenMetadata?.name ?? undefined,
      chain: 'robinhood',
      tokenAddress,
      discoveredAt,
      source: 'PONS',
      sourceType: 'LAUNCHPAD',
      sourceId: log.transactionHash ?? undefined,
      sources: [{
        source: 'PONS',
        sourceType: 'LAUNCHPAD',
        discoveredAt,
        sourceId: log.transactionHash ?? undefined,
        metadata,
      }],
      dexId: 'pons-v2',
      metadata,
    });
  }

  console.log('[PonsDiscovery] Launches found:', tokens.length);

  return {
    source: 'PONS',
    discoveredAt,
    tokens,
  };
}
