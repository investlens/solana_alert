import { parseAbiItem } from 'viem';
import { getPonsFactoryDeployments, type PonsFactoryDeployment } from './ponsContracts.js';
import { decodePonsLaunch, launchIdentity, retryPonsOperation, type PonsLaunch, type PonsRetryOptions, type PonsRpcLog, type PonsScannerRpc } from './ponsHistoricalLaunchScanner.js';

export type PonsLiveDetectorStorage = {
  getLiveCheckpoint(factoryId: string): Promise<bigint | null>;
  persistLaunches(launches: PonsLaunch[]): Promise<void>;
  setLiveCheckpoint(factory: PonsFactoryDeployment, block: bigint): Promise<void>;
};
export type PonsLiveDetectorOptions = {
  fromBlock?: bigint; maxBlocksPerPoll?: bigint; retry?: PonsRetryOptions;
  factories?: PonsFactoryDeployment[]; log?: (line: string) => void;
};

// Process-local safety net. Once a checkpoint has been successfully read or a
// block range has been handled, a temporary Supabase outage must not stop live
// chain scanning. Persistence can catch up later; alert discovery stays live.
const liveCheckpointCache = new Map<string, bigint>();

export async function pollPonsLiveLaunchesOnce(
  rpc: PonsScannerRpc,
  storage: PonsLiveDetectorStorage,
  handleLaunch: (launch: PonsLaunch) => Promise<unknown>,
  options: PonsLiveDetectorOptions = {},
): Promise<{ detected: number; handled: number; duplicates: number }> {
  const log = options.log ?? console.log;
  const retry = { ...options.retry, onRetry: options.retry?.onRetry ?? log };
  const head = await retryPonsOperation('liveGetBlockNumber', () => rpc.getBlockNumber(), retry);
  const factories = options.factories ?? getPonsFactoryDeployments().filter(factory => factory.enabled);
  const seen = new Set<string>();
  let detected = 0; let handled = 0; let duplicates = 0;

  for (const factory of factories) {
    let checkpoint: bigint | null = null;
    if (options.fromBlock == null) {
      try {
        checkpoint = await retryPonsOperation('liveCheckpointRead', () => storage.getLiveCheckpoint(factory.id), retry);
        if (checkpoint != null) liveCheckpointCache.set(factory.id, checkpoint);
      } catch (error) {
        const cached = liveCheckpointCache.get(factory.id);
        if (cached == null) {
          // On a cold start we deliberately scan a conservative recent window
          // rather than jumping to head and silently missing launches.
          checkpoint = head > 300n ? head - 300n : 0n;
          log(`[PonsLive] checkpoint database unavailable factory=${factory.id}; cold-start recovery from block=${checkpoint + 1n}`);
        } else {
          checkpoint = cached;
          log(`[PonsLive] checkpoint database unavailable factory=${factory.id}; using memory checkpoint=${cached}`);
        }
      }
    }

    const requestedFrom = options.fromBlock ?? (checkpoint == null ? head : checkpoint + 1n);
    const maximum = options.maxBlocksPerPoll ?? 2_500n;
    const from = requestedFrom;
    if (from > head) continue;
    const to = from + maximum - 1n < head ? from + maximum - 1n : head;
    const logs = await retryPonsOperation('liveGetLogs', () => rpc.getLogs({
      address: factory.address, event: parseAbiItem(factory.tokenLaunchedEvent), fromBlock: from, toBlock: to,
    }), retry);
    const blockTimestamps = new Map<bigint, bigint>();
    const launches: PonsLaunch[] = [];
    for (const event of logs as readonly PonsRpcLog[]) {
      if (event.blockNumber == null) continue;
      let timestamp = blockTimestamps.get(event.blockNumber);
      if (timestamp == null) {
        timestamp = (await retryPonsOperation('liveGetBlock', () => rpc.getBlock({ blockNumber: event.blockNumber! }), retry)).timestamp;
        blockTimestamps.set(event.blockNumber, timestamp);
      }
      const launch = decodePonsLaunch(factory, event, timestamp);
      if (!launch) continue;
      detected += 1;
      const identity = launchIdentity(launch);
      if (seen.has(identity)) { duplicates += 1; continue; }
      seen.add(identity); launches.push(launch);
    }

    if (launches.length) {
      try {
        await retryPonsOperation('liveLaunchUpsert', () => storage.persistLaunches(launches), retry);
      } catch (error) {
        log(`[PonsLive] launch persistence unavailable factory=${factory.id}; routing ${launches.length} launch(es) without blocking alerts`);
      }
    }

    for (const launch of launches) { await handleLaunch(launch); handled += 1; }

    // Advance process-local progress only after every launch in the range has
    // reached the router. This prevents a persistence outage from halting the
    // scanner while preserving at-least-once alert handling semantics.
    liveCheckpointCache.set(factory.id, to);
    try {
      await retryPonsOperation('liveCheckpointUpsert', () => storage.setLiveCheckpoint(factory, to), retry);
    } catch (error) {
      log(`[PonsLive] checkpoint persistence unavailable factory=${factory.id}; memory checkpoint=${to}`);
    }
    log(`[PonsLive] factory=${factory.id} blocks=${from}-${to} detected=${launches.length}`);
  }
  return { detected, handled, duplicates };
}

export const supabasePonsLiveDetectorStorage: PonsLiveDetectorStorage = {
  async getLiveCheckpoint(factoryId) {
    const { supabase } = await import('../../services/supabase.js');
    const { data, error } = await supabase.from('pons_indexer_checkpoints').select('last_processed_block')
      .eq('chain', 'robinhood').eq('factory_id', `live:${factoryId}`).maybeSingle();
    if (error) throw new Error(`live checkpoint read failed: ${error.message}`);
    return data?.last_processed_block == null ? null : BigInt(data.last_processed_block);
  },
  async persistLaunches(launches) {
    const { supabase } = await import('../../services/supabase.js');
    const { error } = await supabase.from('pons_launches').upsert(launches, {
      onConflict: 'chain,factory_address,transaction_hash,log_index', ignoreDuplicates: true,
    });
    if (error) throw new Error(`live launch persistence failed: ${error.message}`);
  },
  async setLiveCheckpoint(factory, block) {
    const { supabase } = await import('../../services/supabase.js');
    const { error } = await supabase.from('pons_indexer_checkpoints').upsert({
      chain: 'robinhood', protocol: 'pons', factory_id: `live:${factory.id}`,
      factory_address: factory.address.toLowerCase(), last_processed_block: block.toString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'chain,factory_id' });
    if (error) throw new Error(`live checkpoint persistence failed: ${error.message}`);
  },
};
