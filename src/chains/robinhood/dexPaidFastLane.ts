import { discoverFromPons } from './discovery/launchpads/pons.js';
import type { RobinhoodDiscoveredToken } from './discovery/types.js';
import { processRobinhoodDexPaidSignal } from './robinhoodObserver.js';

const INTERVAL_MS = Math.max(10_000, Number(process.env.DEX_PAID_FAST_LANE_INTERVAL_MS ?? 15_000));
const CANDIDATE_TTL_MS = Math.max(5 * 60_000, Number(process.env.DEX_PAID_FAST_LANE_CANDIDATE_TTL_MS ?? 30 * 60_000));
const MAX_CHECKS_PER_CYCLE = Math.max(1, Number(process.env.DEX_PAID_FAST_LANE_MAX_CHECKS ?? 8));
const LIVE_LOOKBACK_BLOCKS = BigInt(Math.max(50, Number(process.env.DEX_PAID_FAST_LANE_LOOKBACK_BLOCKS ?? 300)));
const STARTUP_LOOKBACK_BLOCKS = BigInt(Math.max(Number(LIVE_LOOKBACK_BLOCKS), Number(process.env.DEX_PAID_FAST_LANE_STARTUP_LOOKBACK_BLOCKS ?? 2_000)));

type Candidate = { token: RobinhoodDiscoveredToken; lastSeenAt: number; lastCheckedAt: number };
const candidates = new Map<string, Candidate>();
let started = false;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let firstCycle = true;

function key(address: string) { return address.trim().toLowerCase(); }

function remember(token: RobinhoodDiscoveredToken) {
  const k = key(token.tokenAddress);
  const previous = candidates.get(k);
  candidates.set(k, { token, lastSeenAt: Date.now(), lastCheckedAt: previous?.lastCheckedAt ?? 0 });
}

function prune() {
  const cutoff = Date.now() - CANDIDATE_TTL_MS;
  for (const [k, candidate] of candidates) if (candidate.lastSeenAt < cutoff) candidates.delete(k);
}

async function cycle() {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    const batch = await discoverFromPons(firstCycle ? STARTUP_LOOKBACK_BLOCKS : LIVE_LOOKBACK_BLOCKS);
    firstCycle = false;
    for (const token of batch.tokens) remember(token);
    prune();

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
  console.log('[DexPaidFastLane] Started', {
    intervalSeconds: INTERVAL_MS / 1000,
    maxChecksPerCycle: MAX_CHECKS_PER_CYCLE,
    candidateTtlMinutes: CANDIDATE_TTL_MS / 60_000,
    stalePaymentAlertsSuppressedAfterSeconds: Number(process.env.DEX_PAID_MAX_PAYMENT_AGE_SECONDS ?? 120),
  });
  void cycle();
  timer = setInterval(() => void cycle(), INTERVAL_MS);
}

export function stopDexPaidFastLane() {
  if (timer) clearInterval(timer);
  timer = null; started = false;
}
