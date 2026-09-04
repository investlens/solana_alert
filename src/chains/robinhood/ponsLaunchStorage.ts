import type { PonsFactoryDeployment } from './ponsContracts.js';
import { retryPonsOperation, type PonsLaunch, type PonsRetryOptions, type PonsScannerStorage } from './ponsHistoricalLaunchScanner.js';

type PonsPersistenceOperations = {
  readCheckpoint(factoryId: string): Promise<{ last_processed_block: string | number } | null>;
  upsertLaunches(launches: PonsLaunch[]): Promise<void>;
  upsertCheckpoint(factory: PonsFactoryDeployment, throughBlock: bigint): Promise<void>;
};

export function createPonsLaunchStorage(operations: PonsPersistenceOperations, retry: PonsRetryOptions = {}): PonsScannerStorage {
  return {
  async getCheckpoint(factoryId) {
    const data = await retryPonsOperation('checkpointRead', () => operations.readCheckpoint(factoryId), retry);
    return data?.last_processed_block == null ? null : BigInt(data.last_processed_block);
  },
  async persistChunk(factory: PonsFactoryDeployment, launches: PonsLaunch[], throughBlock: bigint) {
    if (launches.length) await retryPonsOperation('launchUpsert', () => operations.upsertLaunches(launches), retry);
    await retryPonsOperation('checkpointUpsert', () => operations.upsertCheckpoint(factory, throughBlock), retry);
  },
  };
}

export const supabasePonsLaunchStorage = createPonsLaunchStorage({
  async readCheckpoint(factoryId) {
    const { supabase } = await import('../../services/supabase.js');
    const { data, error } = await supabase.from('pons_indexer_checkpoints').select('last_processed_block')
      .eq('chain', 'robinhood').eq('factory_id', factoryId).maybeSingle();
    if (error) throw new Error(`checkpoint read failed: ${error.message}`);
    return data;
  },
  async upsertLaunches(launches) {
    const { supabase } = await import('../../services/supabase.js');
    const { error } = await supabase.from('pons_launches').upsert(launches, {
      onConflict: 'chain,factory_address,transaction_hash,log_index', ignoreDuplicates: true,
    });
    if (error) throw new Error(`launch persistence failed: ${error.message}`);
  },
  async upsertCheckpoint(factory, throughBlock) {
    const { supabase } = await import('../../services/supabase.js');
    const { error } = await supabase.from('pons_indexer_checkpoints').upsert({
      chain: 'robinhood', protocol: 'pons', factory_id: factory.id,
      factory_address: factory.address.toLowerCase(), last_processed_block: throughBlock.toString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'chain,factory_id' });
    if (error) throw new Error(`checkpoint persistence failed: ${error.message}`);
  },
});
