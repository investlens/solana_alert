import { parseAbiItem } from 'viem';
import { getArcLogs } from './rpc.js';

// Verified against Uniswap's Arc deployment documentation on 2026-09-16.
export const ARC_UNISWAP_V4_POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951' as const;
export const ARC_LIQUIDITY_LAUNCHER = '0x542BCDA1015485ef0B1cD11B835DC58DF5102000' as const;
export const ARC_INSTANT_LAUNCH_WITH_CREATOR_FEES = '0x58E5099f22008bc280152c13b636c88d0fE3E132' as const;
export const ARC_INSTANT_LAUNCH_NO_CREATOR_FEES = '0x36F8c87047b212589eD66524Bb69cE62B1f00B2d' as const;

const INITIALIZE_EVENT = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
);

export type ArcPoolLaunch = {
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  poolId: `0x${string}`;
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export async function discoverArcV4Pools(fromBlock: bigint, toBlock: bigint): Promise<ArcPoolLaunch[]> {
  if (toBlock < fromBlock) return [];
  const logs = await getArcLogs({
    address: ARC_UNISWAP_V4_POOL_MANAGER,
    event: INITIALIZE_EVENT,
    fromBlock,
    toBlock,
  });

  return logs.flatMap((log: any) => {
    const args = log.args ?? {};
    if (!log.blockNumber || !log.transactionHash || !args.id || !args.currency0 || !args.currency1) return [];
    return [{
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      poolId: args.id,
      currency0: args.currency0,
      currency1: args.currency1,
      fee: Number(args.fee ?? 0),
      tickSpacing: Number(args.tickSpacing ?? 0),
      hooks: args.hooks,
    }];
  });
}
