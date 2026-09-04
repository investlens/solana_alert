import 'dotenv/config';
import { robinhoodPublicClient } from '../src/chains/robinhood/rpc.js';
import { getPonsLiveConfig } from '../src/chains/robinhood/ponsLiveConfig.js';
import { pollPonsLiveLaunchesOnce, supabasePonsLiveDetectorStorage } from '../src/chains/robinhood/ponsLiveLaunchDetector.js';
import { createPonsLiveLaunchRouter } from '../src/chains/robinhood/ponsLiveLaunchRouter.js';
import { replayPonsLiveLaunch, supabasePonsLiveReplaySource } from '../src/chains/robinhood/ponsLiveReplay.js';
import { parsePonsLiveDevMode, ponsLivePollInterval, runPonsLivePollingLoop } from '../src/chains/robinhood/ponsLivePollingLoop.js';

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
  const result = await pollPonsLiveLaunchesOnce(robinhoodPublicClient as never, dryStorage, route);
  console.log(`[PonsLive] complete detected=${result.detected} handled=${result.handled} duplicates=${result.duplicates} liveStateWrites=0 realTrades=0`);
} else {
  console.log('[PonsLive] mode=SHADOW dryRun=true realTrades=0 liveStateWrites=enabled');
  await runPonsLivePollingLoop({
    pollIntervalMs: ponsLivePollInterval(),
    poll: () => pollPonsLiveLaunchesOnce(robinhoodPublicClient as never, supabasePonsLiveDetectorStorage, route),
  });
}
