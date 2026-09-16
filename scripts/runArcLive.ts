import 'dotenv/config';
import { verifyArcMainnet, getArcBlockNumber } from '../src/chains/arc/rpc.js';
import { discoverArcV4Pools } from '../src/chains/arc/uniswap.js';

const POLL_MS = Math.max(2_000, Number(process.env.ARC_LIVE_POLL_INTERVAL_MS ?? 5_000));
const ENABLED = String(process.env.ARC_LIVE_ENABLED ?? 'false').toLowerCase() === 'true';
const MAX_BLOCKS = Math.max(1, Number(process.env.ARC_LIVE_MAX_BLOCKS_PER_POLL ?? 250));

async function main() {
  console.log('[ArcLive] starting', { enabled: ENABLED, pollIntervalMs: POLL_MS, mode: 'OBSERVE_ONLY' });
  const verified = await verifyArcMainnet();
  console.log('[ArcLive] mainnet verified', { chainId: verified.chainId, blockNumber: verified.blockNumber.toString() });

  if (!ENABLED) {
    console.log('[ArcLive] observer disabled; set ARC_LIVE_ENABLED=true on an isolated service after validation.');
    return;
  }

  let last = verified.blockNumber;
  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
    const current = await getArcBlockNumber();
    if (current <= last) continue;

    const fromBlock = last + 1n;
    const cappedTo = fromBlock + BigInt(MAX_BLOCKS - 1);
    const toBlock = current < cappedTo ? current : cappedTo;
    const pools = await discoverArcV4Pools(fromBlock, toBlock);

    console.log('[ArcLive] scan', {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      poolsDetected: pools.length,
    });

    for (const pool of pools) {
      console.log('[ArcLive] NEW_POOL', {
        blockNumber: pool.blockNumber.toString(),
        tx: pool.transactionHash,
        poolId: pool.poolId,
        currency0: pool.currency0,
        currency1: pool.currency1,
        fee: pool.fee,
        tickSpacing: pool.tickSpacing,
        hooks: pool.hooks,
      });
    }

    last = toBlock;
  }
}

main().catch(error => {
  console.error('[ArcLive] fatal', error);
  process.exitCode = 1;
});
