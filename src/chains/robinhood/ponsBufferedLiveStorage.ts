import type { PonsLiveDetectorStorage } from './ponsLiveLaunchDetector.js';
import { launchIdentity, type PonsLaunch } from './ponsHistoricalLaunchScanner.js';

// Census entries are compact on-chain facts. Never retain images or full market payloads.
// Scanner progress stays in memory between infrequent durable checkpoints.
export function createBufferedPonsLiveStorage(storage: PonsLiveDetectorStorage, options: {
  now?: () => number; log?: (line: string) => void; checkpointMs?: number; retryMs?: number; capacity?: number;
} = {}): PonsLiveDetectorStorage {
  const now = options.now ?? Date.now;
  const log = options.log ?? console.warn;
  const checkpoints = new Map<string, bigint | null>();
  const writtenAt = new Map<string, number>();
  const pending = new Map<string, PonsLaunch>();
  let retryAt = 0;
  async function flush() {
    if (!pending.size || now() < retryAt) return;
    const batch = [...pending.values()];
    try {
      await storage.persistLaunches(batch);
      for (const row of batch) pending.delete(launchIdentity(row));
      retryAt = 0;
      log(`[PonsTracking] censusPersisted=${batch.length} pending=${pending.size}`);
    } catch (error) {
      retryAt = now() + (options.retryMs ?? 60_000);
      log(`[PonsTracking] persistence delayed pending=${pending.size} reason=${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    async getLiveCheckpoint(factoryId) {
      if (checkpoints.has(factoryId)) return checkpoints.get(factoryId)!;
      const value = await storage.getLiveCheckpoint(factoryId);
      checkpoints.set(factoryId, value);
      return value;
    },
    async persistLaunches(rows) {
      for (const row of rows) {
        const key = launchIdentity(row);
        if (!pending.has(key) && pending.size >= (options.capacity ?? 200)) {
          log('[PonsTracking] census buffer full; coverage incomplete');
          continue;
        }
        pending.set(key, row);
      }
      await flush();
    },
    async setLiveCheckpoint(factory, block) {
      checkpoints.set(factory.id, block);
      await flush();
      // Do not checkpoint past launch facts that still need persistence.
      if (pending.size || now() - (writtenAt.get(factory.id) ?? -Infinity) < (options.checkpointMs ?? 300_000)) return;
      writtenAt.set(factory.id, now()); // Also bound retries during a DB outage.
      await storage.setLiveCheckpoint(factory, block);
    },
  };
}
