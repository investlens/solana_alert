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
    const checkpoint = options.fromBlock == null
      ? await retryPonsOperation('liveCheckpointRead', () => storage.getLiveCheckpoint(factory.id), retry)
      : null;
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
    if (launches.length) await retryPonsOperation('liveLaunchUpsert', () => storage.persistLaunches(launches), retry);
    for (const launch of launches) { await handleLaunch(launch); handled += 1; }
    await retryPonsOperation('liveCheckpointUpsert', () => storage.setLiveCheckpoint(factory, to), retry);
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
