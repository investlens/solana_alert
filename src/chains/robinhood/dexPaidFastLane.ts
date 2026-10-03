import { getPonsFactoryDeployments } from './ponsContracts.js';
import { getSharedJson, setSharedJson } from '../../services/sharedJsonCache.js';
import { DEX_PAID_WATCH_TTL_MS, dexPaidWatchLimit, restoreDexPaidWatch, seedDexPaidWatch, snapshotDexPaidWatch, type DexPaidCandidate } from './dexPaidWatchState.js';
import { discoverFromPons } from './discovery/launchpads/pons.js';
import type { RobinhoodDiscoveredToken } from './discovery/types.js';
import { processRobinhoodDexPaidSignal } from './robinhoodObserver.js';

const INTERVAL_MS = Math.max(10_000, Number(process.env.DEX_PAID_FAST_LANE_INTERVAL_MS ?? 15_000));
const CANDIDATE_TTL_MS = Math.max(5 * 60_000, Number(process.env.DEX_PAID_FAST_LANE_CANDIDATE_TTL_MS ?? 30 * 60_000));
const MAX_CHECKS_PER_CYCLE = Math.max(1, Math.min(4, Number(process.env.DEX_PAID_FAST_LANE_MAX_CHECKS ?? 2)));
const LIVE_LOOKBACK_BLOCKS = BigInt(Math.max(50, Number(process.env.DEX_PAID_FAST_LANE_LOOKBACK_BLOCKS ?? 300)));
const STARTUP_LOOKBACK_BLOCKS = BigInt(Math.max(Number(LIVE_LOOKBACK_BLOCKS), Number(process.env.DEX_PAID_FAST_LANE_STARTUP_LOOKBACK_BLOCKS ?? 2_000)));

const WATCH_LIMIT = dexPaidWatchLimit(INTERVAL_MS, MAX_CHECKS_PER_CYCLE);
const CHECKPOINT_KEY = 'alphaos:dex-paid:watch:v1';
const candidates = new Map<string, DexPaidCandidate>();
let restored = false;
let started = false;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let firstCycle = true;

function enabled(): boolean {
  return String(process.env.DEX_PAID_FAST_LANE_ENABLED ?? 'true').toLowerCase() === 'true';
}

function key(address: string) { return address.trim().toLowerCase(); }

function remember(token: RobinhoodDiscoveredToken) {
  const k = key(token.tokenAddress);
  const previous = candidates.get(k);
  if (!previous && candidates.size >= WATCH_LIMIT) {
    const oldest = [...candidates.entries()].sort((a,b)=>a[1].lastSeenAt-b[1].lastSeenAt)[0];
    candidates.delete(oldest[0]);
    console.log('[DexPaidFastLane] WATCH_CAP_EVICTION', {cap:WATCH_LIMIT});
  }
  candidates.set(k, { token, lastSeenAt: Date.now(), lastCheckedAt: previous?.lastCheckedAt ?? 0 });
}

function prune() {
  const cutoff = Date.now() - CANDIDATE_TTL_MS;
  for (const [k, candidate] of candidates) if (candidate.lastSeenAt < cutoff) candidates.delete(k);
}

async function cycle() {
  if (!enabled() || running) return;
  running = true;
  const startedAt = Date.now();
  try {
    if (!restored) {
      const saved = await getSharedJson<unknown>(CHECKPOINT_KEY, 1_000);
      for (const entry of restoreDexPaidWatch(saved?.value, Date.now(), WATCH_LIMIT)) candidates.set(key(entry.token.tokenAddress), entry);
      // One bounded read of the existing verified PONS launch queue also warms
      // the first deployment of this checkpoint. No SQL census sweep is needed.
      const launches = await getSharedJson<unknown>('alphaos:watch:social:v1', 1_000);
      for (const entry of seedDexPaidWatch(launches?.value, Date.now(), WATCH_LIMIT,
        getPonsFactoryDeployments().filter(f=>f.enabled).map(f=>f.address))) {
        if (!candidates.has(key(entry.token.tokenAddress)) && candidates.size < WATCH_LIMIT) candidates.set(key(entry.token.tokenAddress),entry);
      }
      restored = true;
      console.log('[DexPaidFastLane] WATCH_RESTORED', {candidates:candidates.size, cap:WATCH_LIMIT, checkpointRead:saved ? 'PRESENT' : 'MISSING_OR_UNAVAILABLE', socialSeedRead:launches ? 'PRESENT' : 'MISSING_OR_UNAVAILABLE', dbWrites:0});
    }
    const batch = await discoverFromPons(firstCycle ? STARTUP_LOOKBACK_BLOCKS : LIVE_LOOKBACK_BLOCKS);
    firstCycle = false;
    for (const token of batch.tokens) remember(token);
    prune();

    await setSharedJson(CHECKPOINT_KEY, snapshotDexPaidWatch(candidates.values(), Date.now(), WATCH_LIMIT), new Date().toISOString(), DEX_PAID_WATCH_TTL_MS);
    const selected = [...candidates.values()]
      .sort((a, b) => a.lastCheckedAt - b.lastCheckedAt)
      .slice(0, MAX_CHECKS_PER_CYCLE);

    let detected = 0; let failed = 0;
    for (const candidate of selected) {
      candidate.lastCheckedAt = Date.now();
      try { detected += Number(await processRobinhoodDexPaidSignal(candidate.token)); }
      catch (error) {
        failed += 1;
        console.warn('[DexPaidFastLane] candidate check failed', {
          token: candidate.token.tokenAddress,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await setSharedJson(CHECKPOINT_KEY, snapshotDexPaidWatch(candidates.values(), Date.now(), WATCH_LIMIT), new Date().toISOString(), DEX_PAID_WATCH_TTL_MS);
    console.log('[DexPaidFastLane] cycle', {
      discovered: batch.tokens.length,
      candidates: candidates.size,
      checked: selected.length,
      detected,
      failed,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.warn('[DexPaidFastLane] cycle failed', { reason: error instanceof Error ? error.message : String(error) });
  } finally { running = false; }
}

export function startDexPaidFastLane() {
  if (started) return;
  started = true;
  if (!enabled()) {
    console.log('[DexPaidFastLane] disabled; normal DEX_PAID observer remains active');
    return;
  }
  console.log('[DexPaidFastLane] Started', {
    intervalSeconds: INTERVAL_MS / 1000,
    maxChecksPerCycle: MAX_CHECKS_PER_CYCLE,
    candidateTtlMinutes: CANDIDATE_TTL_MS / 60_000,
    watchLimit: WATCH_LIMIT, checkpoint: 'REDIS',
    stalePaymentAlertsSuppressedAfterSeconds: Number(process.env.DEX_PAID_MAX_PAYMENT_AGE_SECONDS ?? 600),
  });
  void cycle();
  timer = setInterval(() => void cycle(), INTERVAL_MS);
}

export function stopDexPaidFastLane() {
  if (timer) clearInterval(timer);
  timer = null; started = false;
}
