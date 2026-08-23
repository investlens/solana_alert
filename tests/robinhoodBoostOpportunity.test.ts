import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOOSTED_OPPORTUNITY_THRESHOLD,
  boostNotificationState,
  buildBoostActions,
  buildBoostMessage,
} from '../src/chains/robinhood/robinhoodBoostObserver.js';
import { verifiedRobinhoodChartUrl } from '../src/chains/robinhood/market.js';

const address = '0x26de761468a48b2f939d60755fe5413ee4a9c03e';
const chartUrl = 'https://dexscreener.com/robinhood/0xverifiedpair';

function preIndexValuation() {
  return {
    tokenAddress: address,
    valueUsd: 4577.85761979312,
    valuationType: 'FDV',
    source: 'PONS_V2_CURVE_RESERVE_SPOT',
    tokenPriceUsd: 0.00000457785761979312,
    tokenPriceSource: 'PONS_V2_CURVE_RESERVE_RATIO',
    quoteAsset: '0x4200000000000000000000000000000000000006',
    quoteUsd: 2441.93,
    quoteUsdSource: 'DEXSCREENER_ROBINHOOD_BASE_TOKEN_PRICE',
    observedAt: new Date().toISOString(),
    indexed: false,
  };
}

const base = {
  symbol: 'SPURDO', name: 'SPURDO', tokenAddress: address,
  boostAmount: 50, totalBoostAmount: BOOSTED_OPPORTUNITY_THRESHOLD,
  devHoldingPercent: 0, burnedPercent: 0, holderTop1Percent: null,
  eventType: 'INCREASE' as const, age: '3m', momentum: 12.4,
  confidence: 82, risk: 'MEDIUM', buys5m: 14, sells5m: 5,
};

test('only cumulative boost totals at or above 200 receive the high-attention state', () => {
  assert.equal(boostNotificationState(99), 'BUILDING');
  assert.equal(boostNotificationState(100), 'BUILDING');
  assert.equal(boostNotificationState(199), 'BUILDING');
  assert.equal(boostNotificationState(200), 'BOOSTED_OPPORTUNITY');
});

test('>=200 indexed boost renders high-attention state and verified current market context', () => {
  const message = buildBoostMessage({
    ...base,
    marketContext: {
      symbol: 'SPURDO', name: 'SPURDO', address,
      marketCap: 25_500, fdv: 30_000, liquidity: 23_070,
      volume5m: 6_830, chartUrl,
    },
    rawData: { preIndexValuation: preIndexValuation(), marketIndexState: 'VERIFIED' },
  });
  assert.match(message, /ALPHAOS · 🚀 BOOSTED OPPORTUNITY/);
  assert.match(message, /Boost\s+<b>200 total \(\+50\)<\/b>/);
  assert.match(message, /Market cap\s+<b>\$25\.5K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$23\.1K<\/b>/);
  assert.match(message, /5m volume\s+<b>\$6\.8K<\/b>/);
  assert.match(message, /Momentum\s+<b>\+12\.40%<\/b>/);
  assert.match(message, /Confidence\s+<b>82\/100<\/b>/);
  assert.match(message, /Risk\s+<b>MEDIUM<\/b>/);
  assert.match(message, /Dev holding\s+<b>0%<\/b>/);
  assert.match(message, /Burned\s+<b>0%<\/b>/);
  assert.doesNotMatch(message, /FDV|INDEXING/);
});

test('>=200 pre-index PONS V2 boost renders verified FDV without fabricated market fields', () => {
  const message = buildBoostMessage({
    ...base,
    rawData: {
      symbol: 'SPURDO', name: 'SPURDO', marketIndexState: 'NOT_INDEXED',
      preIndexValuation: preIndexValuation(),
    },
  });
  assert.match(message, /ALPHAOS · 🚀 BOOSTED OPPORTUNITY/);
  assert.match(message, /FDV\s+<b>\$4\.58K<\/b>/);
  assert.match(message, /verified launch valuation/);
  assert.doesNotMatch(message, /Market cap|Liquidity|5m volume|INDEXING/);
});

test('boost action grammar uses direct verified Chart, full Copy CA, Track and Mute without Trade', () => {
  const actions = buildBoostActions({
    tokenAddress: address, chartUrl, opportunityId: 406, strategyKey: 'PONS_BREAKOUT',
  });
  assert.deepEqual(actions.map(row => row.map(action => action.text)), [
    ['📊 Chart', '🔎 Token'], ['📋 Copy CA'], ['👀 Track', '🔕 Mute'],
  ]);
  assert.equal(actions[0][0].url, chartUrl);
  assert.equal(actions[1][0].callback_data, `COPY_CA_${address}`);
  assert.equal(actions.flat().some(action => action.text.includes('Trade')), false);
  for (const action of actions.flat()) {
    if (action.callback_data) assert.ok(Buffer.byteLength(action.callback_data, 'utf8') <= 64);
  }
});

test('Robinhood Chart routing accepts only a direct verified pair destination', () => {
  assert.equal(verifiedRobinhoodChartUrl({ url: chartUrl }), chartUrl);
  assert.equal(
    verifiedRobinhoodChartUrl({ pairAddress: '0xverifiedpair' }),
    chartUrl,
  );
  assert.equal(verifiedRobinhoodChartUrl({ url: 'https://dexscreener.com/search?q=SPURDO' }), undefined);
  assert.equal(verifiedRobinhoodChartUrl({}), undefined);
});

test('unverified Chart and genuinely missing metrics are omitted', () => {
  const actions = buildBoostActions({ tokenAddress: address, opportunityId: 406, strategyKey: 'PONS_RISK' });
  assert.deepEqual(actions[0].map(action => action.text), ['🔎 Token']);
  const message = buildBoostMessage({
    ...base, totalBoostAmount: 99, age: null, momentum: null,
    confidence: null, risk: null, devHoldingPercent: null, burnedPercent: null,
    buys5m: null, sells5m: null,
  });
  assert.match(message, /ALPHAOS · 📈 BUILDING/);
  assert.doesNotMatch(message, /Market cap|FDV|Liquidity|5m volume|Momentum|Dev holding|Burned|\$0/);
});
