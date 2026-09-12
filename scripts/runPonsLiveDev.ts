import 'dotenv/config';
import { robinhoodPublicClient } from '../src/chains/robinhood/rpc.js';
import { getPonsLiveConfig } from '../src/chains/robinhood/ponsLiveConfig.js';
import { pollPonsLiveLaunchesOnce, supabasePonsLiveDetectorStorage } from '../src/chains/robinhood/ponsLiveLaunchDetector.js';
import { createPonsLiveLaunchRouter } from '../src/chains/robinhood/ponsLiveLaunchRouter.js';
import { replayPonsLiveLaunch, supabasePonsLiveReplaySource } from '../src/chains/robinhood/ponsLiveReplay.js';
import { parsePonsLiveDevMode, ponsLivePollInterval, runPonsLivePollingLoop } from '../src/chains/robinhood/ponsLivePollingLoop.js';
import { collectPonsTokenOutcomes, createProductionPonsOutcomeSource, formatPonsOutcomeSummary } from '../src/chains/robinhood/ponsTokenOutcomeCollector.js';

const mode = parsePonsLiveDevMode(process.argv.slice(2));
const sendTelegramTest = process.argv.includes('--send-telegram');
if (sendTelegramTest && mode.kind !== 'REPLAY') throw new Error('--send-telegram is supported only with --replay-token');
const configured = getPonsLiveConfig();
const config = mode.kind === 'REPLAY' ? { ...configured, liveIntelligenceEnabled: true,
  provenDeveloperAlertsEnabled: true, shadowBuyEnabled: sendTelegramTest ? false : true } : configured;
if (!config.liveIntelligenceEnabled) {
  console.log('[PonsLive] disabled; set PONS_LIVE_INTELLIGENCE_ENABLED=true for an explicit dry/shadow run');
  process.exit(0);
}
const route = createPonsLiveLaunchRouter({ config,
  ...(mode.kind !== 'CONTINUOUS' && !sendTelegramTest
    ? { emitAlert: async (alert: { text: string }) => { console.log(alert.text); } }
    : {}),
});

// Live discovery should recover on the next poll rather than spending minutes retrying
// one transient persistence request. We never skip the checkpoint or advance to head.
const liveRetry = { attempts: 2, baseDelayMs: 1_000, maxDelayMs: 2_000, jitterMs: 250 };

// Keep Pons outcome learning alive inside the dedicated Pons service.
let ponsOutcomeCollectionRunning = false;

async function runPonsOutcomeCollection(): Promise<void> {
  if (ponsOutcomeCollectionRunning) {
    console.log('[PonsOutcomes] skipped; previous collection is still running');
    return;
  }

  ponsOutcomeCollectionRunning = true;
  try {
    const limitRaw = Number(process.env.PONS_OUTCOME_COLLECTION_LIMIT ?? 250);
    const concurrencyRaw = Number(process.env.PONS_OUTCOME_COLLECTION_CONCURRENCY ?? 3);
    const limit = Number.isInteger(limitRaw) ? Math.min(1_000, Math.max(1, limitRaw)) : 250;
    const concurrency = Number.isInteger(concurrencyRaw) ? Math.min(20, Math.max(1, concurrencyRaw)) : 3;
    const source = await createProductionPonsOutcomeSource();
    const result = await collectPonsTokenOutcomes(source, {
      filters: { limit, newestFirst: true },
      concurrency,
      write: true,
      progressInterval: 50,
      onProgress: progress => console.log(
        `[PonsOutcomes] progress=${progress.processed}/${progress.total} currentMcFound=${progress.currentMcFound} historicalFound=${progress.historicalFound} failures=${progress.currentLookupFailures}`,
      ),
    });
    for (const line of formatPonsOutcomeSummary(result, false)) console.log(line);
  } catch (error) {
    console.error(`[PonsOutcomes] automatic collection failed reason=${error instanceof Error ? error.message : String(error)}`);
  } finally {
    ponsOutcomeCollectionRunning = false;
  }
}

function startPonsOutcomeCollectionLoop(): void {
  const enabled = String(process.env.PONS_OUTCOME_COLLECTION_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[PonsOutcomes] automatic collection disabled');
    return;
  }

  const configuredInterval = Number(process.env.PONS_OUTCOME_COLLECTION_MS ?? 15 * 60 * 1000);
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.max(5 * 60 * 1000, configuredInterval)
    : 15 * 60 * 1000;

  console.log(`[PonsOutcomes] automatic collection enabled intervalMs=${intervalMs}`);
  void runPonsOutcomeCollection();
  setInterval(() => { void runPonsOutcomeCollection(); }, intervalMs);
}

if (mode.kind === 'REPLAY') {
  console.log('[PonsLiveReplay] mode=SHADOW dryRun=true liveStateWrites=0 realTrades=0');
  await replayPonsLiveLaunch(mode.tokenAddress, supabasePonsLiveReplaySource, route);
  process.exit(0);
}
const dryStorage = {
  getLiveCheckpoint: async () => null,
  persistLaunches: async () => {},
  setLiveCheckpoint: async () => {},
};
if (mode.kind === 'ONCE') {
  console.log('[PonsLive] mode=SHADOW dryRun=true liveStateWrites=0 realTrades=0');
  const result = await pollPonsLiveLaunchesOnce(robinhoodPublicClient as never, dryStorage, route, { retry: liveRetry });
  console.log(`[PonsLive] complete detected=${result.detected} handled=${result.handled} duplicates=${result.duplicates} liveStateWrites=0 realTrades=0`);
} else {
  console.log('[PonsLive] mode=SHADOW dryRun=true realTrades=0 liveStateWrites=enabled');
  startPonsOutcomeCollectionLoop();
  await runPonsLivePollingLoop({
    pollIntervalMs: ponsLivePollInterval(),
    poll: () => pollPonsLiveLaunchesOnce(robinhoodPublicClient as never, supabasePonsLiveDetectorStorage, route, { retry: liveRetry }),
  });
}
