import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalizeCoreDecisionMetrics, normalizeNotificationMarketContext } from '../src/ui/notificationMarketContext.js';
import { buildPremiumTokenNotification, verifiedPairAge } from '../src/ui/premiumTokenNotification.js';

const base = {
  state: 'DEX_PAID' as const, symbol: 'PAID', name: 'Paid Token',
  address: '0x1111111111111111111111111111111111111111',
  insightTitle: 'VERIFIED EVENT', insight: ['DEX profile/payment detected.'],
  statusTitle: '💎 STATUS', status: 'Dex Paid confirmed.',
};

test('DEX Paid and BOOST render only verified lightweight context with truthful MC/FDV labels', () => {
  const evidence = normalizeCoreDecisionMetrics({ devHoldingPercent: 3.7, devHoldingEvidence: 'VERIFIED' });
  const paid = buildPremiumTokenNotification({ ...base, age: '17m', evidence,
    market: normalizeNotificationMarketContext({ marketCap: 84_200, fdv: 99_000, liquidity: 18_400, volume5m: 12_100 }) });
  assert.match(paid, /💵 Market cap <b>\$84\.2K<\/b>/);
  assert.doesNotMatch(paid, /<b>FDV:<\/b>/);
  assert.match(paid, /👨‍💻 Dev holding <b>3\.7%<\/b>/);
  assert.match(paid, /💧 Liquidity <b>\$18\.4K<\/b>/);
  assert.match(paid, /📊 5m volume <b>\$12\.1K<\/b>/);
  assert.match(paid, /⏱ Age <b>17m<\/b>/);

  const boost = buildPremiumTokenNotification({ ...base, state: 'BOOST', boostTotal: 200, boostIncrement: 100,
    market: normalizeNotificationMarketContext({ fdv: 126_000 }) });
  assert.match(boost, /💵 FDV <b>\$126\.0K<\/b>/); assert.doesNotMatch(boost, /Market cap/);
  assert.match(boost, /⚡ Boost <b>200 total \(\+100\)<\/b>/);
});

test('missing or failed optional context remains clean and cannot block base informational rendering', () => {
  const message = buildPremiumTokenNotification({ ...base,
    evidence: normalizeCoreDecisionMetrics({ devHoldingEvidence: 'UNAVAILABLE' }),
    market: normalizeNotificationMarketContext({}) });
  assert.match(message, /DEX PAID/);
  assert.doesNotMatch(message, /Market cap|Dev holding|Liquidity|5m volume|Age/);
  assert.equal(verifiedPairAge(null), null);
  assert.equal(verifiedPairAge(Date.now() + 1_000), null);
  assert.equal(verifiedPairAge(Date.now() - 17 * 60_000), '17m');
});

test('DEX Paid and BOOST preserve identities, bounded optional enrichment, shared delivery and on-demand Full Intel', async () => {
  const [observer, boost] = await Promise.all([
    readFile(new URL('../src/chains/robinhood/robinhoodObserver.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(observer, /identity: `\$\{token\.tokenAddress\.toLowerCase\(\)\}:\$\{dexPaid\.latestPaymentTimestamp\}`/);
  assert.match(observer, /queueWaitTimeoutMs: 750/); assert.match(observer, /\.catch\(\(\) => null\)/);
  assert.match(observer, /fullIntelCallback: `FI_RH_\$\{token\.tokenAddress\}`/);
  assert.match(observer, /deliverAlphaSemanticEvent/);
  assert.match(boost, /identity: String\(eventId\)/); assert.match(boost, /deliverAlphaSemanticEvent/);
  assert.match(boost, /caller: 'robinhood_boost_observer', queueWaitTimeoutMs: 750/);
  assert.doesNotMatch(boost, /scanRobinhoodDevTokenFlow|scanRobinhoodHolderRisk/);
  assert.match(boost, /fullIntelCallback: `FI_RH_\$\{args\.tokenAddress\}`/);
});

test('winner processing persists crossed state before selecting one delivery and has no startup backfill entrypoint', async () => {
  const source = await readFile(new URL('../src/services/runnerMilestoneService.ts', import.meta.url), 'utf8');
  assert.match(source, /runnerEvents\.set\(kind, event\)/);
  assert.match(source, /selectWinnerDelivery\(\{ runner50: plan\.runner50, runner100: plan\.runner100/);
  assert.match(source, /primary === 'RUNNER_50' \|\| primary === 'RUNNER_100'/);
  assert.doesNotMatch(source, /setInterval|startRunnerMilestone|backfill/i);
});
