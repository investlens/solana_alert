import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getAddress } from 'viem';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';

test('ordinary lifecycle states remain internal while premium categories retain owners', async () => {
  const pons = await readFile(new URL('../src/chains/robinhood/ponsShadowOutcomeTracker.ts', import.meta.url), 'utf8');
  const observer = await readFile(new URL('../src/chains/robinhood/robinhoodObserver.ts', import.meta.url), 'utf8');
  const outcome = await readFile(new URL('../src/chains/robinhood/robinhoodOutcomeTracker.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(pons, /sendTelegram\(/);
  assert.match(observer, /no standalone launch Telegram/);
  assert.match(outcome, /Internal-only lifecycle evidence recorded/);
  assert.match(observer, /type: 'DEX_PAID'/);
});

test('premium opportunity policy respects early silence and 15–30m survival with volume', async () => {
  const { qualifyPremiumOpportunity } = await import('../src/services/opportunityDeliveryService.js');
  assert.equal(qualifyPremiumOpportunity({ elapsedSec: 60, currentRoi: 12, recentPeakRoi: 12,
    volumeMultiple: 2.9 }, 'CHECK_ENTRY').eligible, false);
  assert.equal(qualifyPremiumOpportunity({ elapsedSec: 60, currentRoi: 12, recentPeakRoi: 12,
    volumeMultiple: 3 }, 'CHECK_ENTRY').eligible, true);
  assert.equal(qualifyPremiumOpportunity({ elapsedSec: 1_080, currentRoi: 12, recentPeakRoi: 15,
    volumeMultiple: 1.5 }, 'CHECK_ENTRY').eligible, true);
  assert.equal(qualifyPremiumOpportunity({ elapsedSec: 1_080, currentRoi: 12, recentPeakRoi: 15,
    volumeMultiple: 1.49 }, 'CHECK_ENTRY').eligible, false);
});

test('volume ignition is comparative, healthy, and unchanged volume is ineligible', async () => {
  const { volumeIgnitionDecision } = await import('../src/chains/robinhood/robinhoodBoostObserver.js');
  const healthy = volumeIgnitionDecision({ previousVolume5m: 100, currentVolume5m: 180,
    previousPrice: 1, currentPrice: 1.05, previousLiquidity: 10_000, currentLiquidity: 9_000,
    buys5m: 20, sells5m: 10 });
  assert.equal(healthy.eligible, true); assert.equal(healthy.volumeMultiple, 1.8);
  assert.equal(volumeIgnitionDecision({ previousVolume5m: 100, currentVolume5m: 100,
    previousPrice: 1, currentPrice: 1 }).eligible, false);
  assert.equal(volumeIgnitionDecision({ previousVolume5m: 100, currentVolume5m: 180,
    previousPrice: 1, currentPrice: 0.4 }).eligible, false);
});

test('boost 500 is major, verified burn starts at 1%, and transfer remains internal', async () => {
  const { boostPresentationState, buildBoostMessage } = await import('../src/chains/robinhood/robinhoodBoostObserver.js');
  const { developerEvent } = await import('../src/intelligence/tokenIntelligenceState.js');
  assert.equal(boostPresentationState(499), 'BOOST'); assert.equal(boostPresentationState(500), 'MAJOR_BOOST');
  assert.match(buildBoostMessage({ symbol: 'AAA', tokenAddress: '0x257012345678901234567890123456789008444e',
    boostAmount: 100, totalBoostAmount: 500, devHoldingPercent: null, holderTop1Percent: null,
    eventType: 'INCREASE' }), /MAJOR BOOST/);
  assert.equal(developerEvent({ burnedPercent: 0.99, evidence: 'VERIFIED' }).notify, false);
  assert.equal(developerEvent({ burnedPercent: 1, evidence: 'VERIFIED' }).notify, true);
  assert.equal(developerEvent({ transferredPercent: 10, evidence: 'VERIFIED' }).notify, false);
});

test('developer history above three is negative evidence without automatic rejection', async () => {
  const { creatorHistoryPenalty } = await import('../src/chains/robinhood/robinhoodCreatorRisk.js');
  assert.equal(creatorHistoryPenalty({ launches: 3, severeCrashes: 0, catastrophicCrashes: 0 }), 0);
  const penalty = creatorHistoryPenalty({ launches: 4, severeCrashes: 0, catastrophicCrashes: 0 });
  assert.ok(penalty > 0 && penalty < 50);
});

test('developer sell needs prior premium relevance', async () => {
  const { developerSellHasUserRelevance } = await import('../src/chains/robinhood/security/devPostAlertWatcher.js');
  assert.equal(developerSellHasUserRelevance([]), false);
  assert.equal(developerSellHasUserRelevance([{ semantic_event_type: 'BUILDING' }]), false);
  assert.equal(developerSellHasUserRelevance([{ semantic_event_type: 'BOOST' }]), true);
  assert.equal(developerSellHasUserRelevance([{ alert_type: 'CHECK_ENTRY' }]), true);
});

test('AAA fixture remains BUY and wallet path uses case-insensitive subscriber/cursor identity', async () => {
  const { classifyRobinhoodWalletTransaction } = await import('../src/chains/robinhood/robinhoodWalletWatcher.js');
  const wallet = getAddress('0xF435ac0cb3eC9D871CE5D592bAd9214338D2E7D7');
  const aaa = getAddress('0x6C58D6F67f728A74158E31FA1B6b497967e4786F');
  const classification = classifyRobinhoodWalletTransaction(wallet, {
    hash: '0x257a6988a587275882761b5bee52f842301cbd513699dd08e7b1ed47ecf7c16c',
    from: wallet, value: 20_000_000_000_000_000n,
    transfers: [{ token: aaa, from: getAddress('0x39b38686A19836Ac10162c490E4558e120CbBE5f'),
      to: wallet, value: 946_007_458_403_385_118_437_064n }],
  });
  assert.equal(classification?.kind, 'buy');
  const tracked = await readFile(new URL('../src/services/trackedWalletService.ts', import.meta.url), 'utf8');
  const watcher = await readFile(new URL('../src/chains/robinhood/robinhoodWalletWatcher.ts', import.meta.url), 'utf8');
  assert.match(tracked, /\.ilike\(\s*'wallet_address'/);
  assert.match(watcher, /wallet\.toLowerCase\(\)/);
});

test('shared actions use final labels, exact CA, no PONS Trade, and safe callbacks', async () => {
  const { buildAlphaMarketActions } = await import('../src/ui/alphaNotificationActions.js');
  const address = '0x257012345678901234567890123456789008444e';
  const actions = buildAlphaMarketActions({ chartUrl: 'https://dexscreener.com/robinhood/pair',
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}`,
    copyContractCallback: `COPY_CA_${address}`, trackCallback: 'OPP_TRACK_42', muteCallback: 'STRAT_TOGGLE_PONS_BREAKOUT' });
  assert.deepEqual(actions.map(row => row.map(action => action.text)),
    [['📊 Chart', '🔎 Token'], ['📋 Copy CA'], ['⭐ Track', '🔕 Mute']]);
  assert.equal(actions.flat().find(action => action.text === '📋 Copy CA')?.callback_data, `COPY_CA_${address}`);
  assert.equal(actions.flat().some(action => /Trade/.test(action.text)), false);
  for (const action of actions.flat()) if (action.callback_data) assert.ok(Buffer.byteLength(action.callback_data) <= 64);
});

test('premium outcomes cover all horizons and unavailable prices carry a reason', async () => {
  const { ALPHA_OUTCOME_CHECKPOINTS, buildAlphaOutcomeCheckpoint, premiumEventNeedsOutcome } =
    await import('../src/services/alphaAlertOutcomeCheckpoints.js');
  assert.deepEqual([...ALPHA_OUTCOME_CHECKPOINTS], [30, 60, 180, 300, 900, 1800, 3600]);
  assert.equal(premiumEventNeedsOutcome({ semantic_event_type: 'BOOST' }), true);
  assert.equal(premiumEventNeedsOutcome({ semantic_event_type: 'BUILDING' }), false);
  const row = buildAlphaOutcomeCheckpoint({ event: { id: 1, asset_id: 'token', chain: 'robinhood',
    price: null, alerted_at: new Date().toISOString() }, checkpointSeconds: 30, currentPrice: null,
    source: null, provenance: null, prior: [], unavailableReason: 'ROBINHOOD_MARKET_UNAVAILABLE' });
  assert.equal(row.status, 'UNAVAILABLE');
  assert.equal((row.completeness as Record<string, unknown>).reason, 'ROBINHOOD_MARKET_UNAVAILABLE');
});
