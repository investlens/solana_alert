import { getPonsFactoryDeployments } from './ponsContracts.js';
import { governedDexScreenerJson } from '../../services/dexscreenerRequestGovernor.js';
import { fetchRobinhoodBoosts } from './discovery.js';
import { getSharedJson, setSharedJson } from '../../services/sharedJsonCache.js';
import { DEX_PAID_WATCH_TTL_MS, rememberDexPaidCandidate, dexPaidFeedCandidates, dexPaidWatchLimit, restoreDexPaidWatch, seedDexPaidWatch, snapshotDexPaidWatch, type DexPaidCandidate } from './dexPaidWatchState.js';
import { discoverFromPons } from './discovery/launchpads/pons.js';
import type { RobinhoodDiscoveredToken } from './discovery/types.js';
import { processRobinhoodDexPaidSignal } from './robinhoodObserver.js';

const INTERVAL_MS = Math.max(10_000, Number(process.env.DEX_PAID_FAST_LANE_INTERVAL_MS ?? 15_000));
const CANDIDATE_TTL_MS = Math.max(5 * 60_000, Number(process.env.DEX_PAID_FAST_LANE_CANDIDATE_TTL_MS ?? DEX_PAID_WATCH_TTL_MS));
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
let nextFeedDiscoveryAt = 0;
async function discoverPromotionFeeds() {
  if(Date.now()<nextFeedDiscoveryAt)return;
  nextFeedDiscoveryAt=Date.now()+60_000;
  // Reuse the existing one-hour launch queue continuously, not only on startup.
  const launches=await getSharedJson<unknown>('alphaos:watch:social:v1',1_000);
  const seeds=seedDexPaidWatch(launches?.value,Date.now(),WATCH_LIMIT,
    getPonsFactoryDeployments().filter(f=>f.enabled).map(f=>f.address));
  // Oldest first gives newer launches priority when the bounded watch is full.
  for(const entry of [...seeds].reverse()) {
    const k=key(entry.token.tokenAddress);
    if(!candidates.has(k))rememberDexPaidCandidate(candidates,entry.token,entry.lastSeenAt,WATCH_LIMIT);
  }
  console.info('[DexPaidFastLane] PONS_WATCH_REFRESH',{seeded:seeds.length,cap:WATCH_LIMIT,dbWrites:0});
  const results=await Promise.allSettled([
    governedDexScreenerJson<unknown>({url:'https://api.dexscreener.com/token-profiles/latest/v1',
      caller:'dex_paid_profile_discovery',endpoint:'PROFILES',priority:'NORMAL',cacheTtlMs:60_000,
      queueWaitTimeoutMs:1_000,httpTimeoutMs:2_500}).then(result=>dexPaidFeedCandidates(result.value,Date.now())),
    fetchRobinhoodBoosts().then(rows=>dexPaidFeedCandidates(rows.map(row=>({chainId:'robinhood',tokenAddress:row.tokenAddress})),Date.now())),
  ]);
  let discovered=0;
  for(const result of results) {
    if(result.status==='fulfilled')for(const token of result.value){remember(token);discovered++;}
    else console.warn('[DexPaidFastLane] promotion discovery unavailable; retained candidates remain active');
  }
  console.info('[DexPaidFastLane] PROMOTION_FEEDS',{discovered,cap:WATCH_LIMIT,dbWrites:0});
}

function enabled(): boolean {
  return String(process.env.DEX_PAID_FAST_LANE_ENABLED ?? 'true').toLowerCase() === 'true';
}

function key(address: string) { return address.trim().toLowerCase(); }

function remember(token: RobinhoodDiscoveredToken) {
  const before=candidates.size, existed=candidates.has(key(token.tokenAddress));
  const admitted=rememberDexPaidCandidate(candidates,token,Date.now(),WATCH_LIMIT);
  if(!admitted)console.info('[DexPaidFastLane] PROMOTION_DEFERRED_PONS_PROTECTED',{cap:WATCH_LIMIT});
  else if(!existed && before>=WATCH_LIMIT && candidates.size===before)console.info('[DexPaidFastLane] WATCH_ROTATED',{cap:WATCH_LIMIT,source:token.source});
}

function prune() {
  const cutoff = Date.now() - CANDIDATE_TTL_MS;
  for (const [k, candidate] of candidates) if (candidate.lastSeenAt < (candidate.token.source==='PONS'?Date.now()-DEX_PAID_WATCH_TTL_MS:cutoff)) candidates.delete(k);
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
    await discoverPromotionFeeds();
    const batch = await discoverFromPons(firstCycle ? STARTUP_LOOKBACK_BLOCKS : LIVE_LOOKBACK_BLOCKS).catch(()=>{
      console.warn('[DexPaidFastLane] launch discovery unavailable; checking retained/promoted tokens');return {tokens:[]};
    });
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
          reason: error instanceof Error ? error.message.slice(0,240)
            : typeof (error as {message?:unknown})?.message === 'string'
              ? String((error as {message:string}).message).slice(0,240) : 'Unknown candidate-check error',
          code: typeof (error as {code?:unknown})?.code === 'string' ? (error as {code:string}).code : undefined,
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
    discovery: 'PONS + Robinchain profiles + boosts', noTokenAgeLimit: true,
    stalePaymentAlertsSuppressedAfterSeconds: Number(process.env.DEX_PAID_MAX_PAYMENT_AGE_SECONDS ?? 600),
  });
  void cycle();
  timer = setInterval(() => void cycle(), INTERVAL_MS);
}

export function stopDexPaidFastLane() {
  if (timer) clearInterval(timer);
  timer = null; started = false;
}
