import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTelegramInvestigation } from '../src/renderers/telegramRenderer.js';
import { buildProAlertMessage } from '../src/ui/proAlertMessageBuilder.js';
import { buildPumpfunEarlyMessage } from '../src/ui/pumpfunMessageBuilder.js';
import { marketContextMetrics, normalizeNotificationMarketContext } from '../src/ui/notificationMarketContext.js';

const address = 'TokenMint111111111111111111111111111111111';

async function opportunityMessage(action: string, rawData: Record<string, unknown>) {
  await import('dotenv/config');
  const { buildOpportunityMessage } = await import('../src/services/opportunityDeliveryService.js');
  return buildOpportunityMessage({
    id: 77, asset_id: address, chain: 'robinhood', strategy_key: 'PONS_BREAKOUT',
    recommended_action: action, status: 'NEW', title: 'PONS lifecycle update',
    why: 'Measured market state changed.', what_happened: null, invalidation: null,
    risk_reason: null, confidence: 81, risk_score: 35, raw_data: rawData,
  });
}

test('shared market normalization preserves strongest reliable producer context', () => {
  const context = normalizeNotificationMarketContext(
    { token_symbol: 'alpha', token_address: address },
    { marketCapUsd: 48_200, liquidityUsd: 12_500, volume5mUsd: 4_200 },
  );
  assert.equal(context.symbol, 'alpha');
  assert.equal(context.address, address);
  assert.deepEqual(marketContextMetrics(context).map(metric => metric.label), ['Market cap', 'Liquidity', '5m volume']);
});

test('PONS Entry Ready, Watching and Risk preserve symbol and market context', async () => {
  for (const action of ['BUY', 'WATCH', 'EXIT']) {
    const message = await opportunityMessage(action, {
      symbol: 'ponsy', marketCap: 48_200, liquidity: 12_500, currentRoi: 5.2,
    });
    assert.match(message, /<b>PONSY<\/b> · <code>TokenM…11111<\/code>/);
    assert.match(message, /Market cap\s+<b>\$48\.2K<\/b>/);
    assert.match(message, /Liquidity\s+<b>\$12\.5K<\/b>/);
    assert.match(message, /Confidence\s+<b>81\/100<\/b>/);
    assert.match(message, /Risk\s+<b>/);
  }
});

test('Solana producer payload symbol, market cap and liquidity reach the alert', () => {
  const pair = { baseToken: { symbol: 'solx', name: 'Sol X', address } };
  const result = {
    score: 84, marketSafetyScore: 72, marketSafetyLabel: 'GOOD', risk: 'LOW',
    marketCap: 65_000, fdv: 70_000, liquidityUsd: 18_000, volume5m: 9_000,
    buys5m: 80, sells5m: 20, checksBad: [], checksWarn: [],
  };
  const message = buildProAlertMessage({ pair, result, state: {}, bucket: 'BUY' } as any);
  assert.match(message, /<b>SOLX<\/b>/);
  assert.match(message, /Market cap\s+<b>\$65\.0K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$18\.0K<\/b>/);
});

test('DEX-paid investigation carries token identity and reliable market context', () => {
  const message = renderTelegramInvestigation({
    token: { symbol: 'dexy', address },
    signal: { timingLabel: 'Early', ageMinutes: 4 },
    ai: { verdict: 'BUY', confidence: 79, riskLevel: 'LOW', reasons: [] },
    market: { marketCap: 90_000, liquidity: 22_000, volume5m: 8_000 },
    orderflow: { buys5m: 60, sells5m: 15 }, creator: { wallet: null, score: 0 },
  } as any);
  assert.match(message, /<b>DEXY<\/b>/);
  assert.match(message, /Market cap\s+<b>\$90\.0K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$22\.0K<\/b>/);
});

test('Robinhood early watch and boost preserve snapshot identity and market context', async () => {
  await import('dotenv/config');
  const { buildWatchMessage } = await import('../src/chains/robinhood/robinhoodObserver.js');
  const { buildBoostMessage } = await import('../src/chains/robinhood/robinhoodBoostObserver.js');
  const market = {
    symbol: 'hood', name: 'Robinhood Token', priceUsd: 0.01,
    marketCapUsd: 25_500, liquidityUsd: 23_070, volume5mUsd: 6_830,
  };
  const watch = buildWatchMessage({
    token: { symbol: 'hood', name: 'Robinhood Token', tokenAddress: address, sources: [] },
    market, contractScore: 88, adminPenalty: 0, sellStatus: 'PASS', sellImpact: 0.13,
    holderRisk: 'LOW', holderCount: 12, devHoldingPercent: 2, devHoldingStatus: 'LOW',
    dexPaid: true, dexPaidStatus: 'PAID', top1Pct: 8, creatorStatus: null,
    creatorScore: null, creatorLaunches: 0, creatorHit100k: 0, creatorHit500k: 0,
    creatorHit1m: 0, creatorBestPeakMarketCap: 0, warnings: [],
  } as any);
  assert.match(watch, /<b>HOOD<\/b>/);
  assert.match(watch, /Market cap\s+<b>\$25\.5K<\/b>/);
  assert.match(watch, /Liquidity\s+<b>\$23\.1K<\/b>/);

  const boost = buildBoostMessage({
    symbol: 'hood', tokenAddress: address, boostAmount: 5, totalBoostAmount: 10,
    price: 0.01, marketCap: 25_500, liquidity: 23_070, volume5m: 6_830,
    buys5m: 40, sells5m: 10, devHoldingPercent: 2, burnedPercent: 4.2,
    holderTop1Percent: 8, eventType: 'NEW',
  });
  assert.match(boost, /<b>HOOD<\/b>/);
  assert.match(boost, /Market cap\s+<b>\$25\.5K<\/b>/);
  assert.match(boost, /Liquidity\s+<b>\$23\.1K<\/b>/);
  assert.match(boost, /Dev holding\s+<b>2%<\/b>/);
  assert.match(boost, /Burned\s+<b>4\.2%<\/b>/);
});

test('Pump.fun renders known symbol and market cap without fabricating missing values', () => {
  const complete = buildPumpfunEarlyMessage({
    symbol: 'pump', name: 'Pump Token', mint: address, marketCapUsd: 31_000,
    volumeUsd: 4_000, launchScore: 76,
  });
  assert.match(complete, /<b>PUMP<\/b>/);
  assert.match(complete, /Market cap\s+<b>\$31\.0K<\/b>/);

  const missing = buildPumpfunEarlyMessage({ mint: address, marketCapUsd: null, launchScore: null });
  assert.doesNotMatch(missing, /Market cap|\$0|<b>Tracking<\/b>/);
});

test('invalid or zero market context is omitted rather than represented as data', () => {
  const context = normalizeNotificationMarketContext({
    symbol: 'SAFE', marketCap: 0, liquidity: Number.NaN,
  });
  assert.equal(context.symbol, 'SAFE');
  assert.deepEqual(marketContextMetrics(context), []);
});
