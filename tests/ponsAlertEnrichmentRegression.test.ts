import assert from 'node:assert/strict';
import test from 'node:test';

import type { TokenOpenTarget } from '../src/core/tokenOpenRouter.js';

const address = '0x23e516c1261af6f40e44abbecb29b22e192669cb';

async function service() {
  await import('dotenv/config');
  return import('../src/services/opportunityDeliveryService.js');
}

function opportunity(raw_data: Record<string, unknown>) {
  return {
    id: 406, asset_id: address, chain: 'robinhood', strategy_key: 'PONS_BREAKOUT',
    recommended_action: 'CHECK_ENTRY', status: 'NEW', title: 'PONS entry',
    why: 'Momentum turned positive after an earlier dip.', what_happened: null,
    invalidation: null, risk_reason: null, confidence: 89, risk_score: 22, raw_data,
  };
}

test('PONS synchronization preserves all already-known market context', async () => {
  await import('dotenv/config');
  const { buildPonsOpportunityRawData } = await import('../src/chains/robinhood/ponsShadowOutcomeTracker.js');
  const raw = buildPonsOpportunityRawData({
    token: address, symbol: 'yomogi', name: 'Yomogi in Hood', marketCap: 52_000,
    liquidity: 19_000, volume5m: 8_400, chartUrl: 'https://dexscreener.com/robinhood/pair',
    state: 'ENTRY_WINDOW', reason: 'Momentum turned positive.', currentRoi: 9.89,
    roiChange: 17.42, recentPeakRoi: 9.89, elapsedSec: 31,
  });
  assert.deepEqual(
    { symbol: raw.symbol, name: raw.name, marketCap: raw.marketCap, liquidity: raw.liquidity,
      volume5m: raw.volume5m, chartUrl: raw.chartUrl },
    { symbol: 'yomogi', name: 'Yomogi in Hood', marketCap: 52_000, liquidity: 19_000,
      volume5m: 8_400, chartUrl: 'https://dexscreener.com/robinhood/pair' },
  );
});

test('production-case delivery enrichment renders identity, market metrics and verified chart', async () => {
  const { buildButtons, buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  const target: TokenOpenTarget = {
    chartUrl: 'https://dexscreener.com/robinhood/pair',
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}`,
    chartSource: 'dexscreener', tokenSource: 'blockscout',
    marketContext: { symbol: 'YOMOGI', name: 'Yomogi in Hood', address, marketCap: 52_000,
      liquidity: 19_000, volume5m: 8_400, chartUrl: 'https://dexscreener.com/robinhood/pair' },
  };
  const row = opportunity({ elapsedSec: 31, currentRoi: 9.89, roiChange: 17.42 });
  row.raw_data = mergeOpportunityMarketContext(row, target.marketContext, 'VERIFIED');
  const message = buildOpportunityMessage(row);
  assert.match(message, /<b>YOMOGI<\/b> · <code>0x23e5…669cb<\/code>/);
  assert.match(message, /Market cap\s+<b>\$52\.0K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$19\.0K<\/b>/);
  assert.match(message, /5m volume\s+<b>\$8\.4K<\/b>/);
  assert.doesNotMatch(message, /INDEXING|still indexing/i);
  const buttons = buildButtons(row, target, { telegram_id: '1', tier: 'paid', is_admin: false } as any);
  assert.deepEqual(buttons[0].map(button => button.text), ['📊 Chart', '🔎 Token']);
  assert.equal(buttons.flat().some(button => button.text.includes('Trade')), false);
});

test('fresh verified PONS identity with confirmed market miss renders INDEXING without fake values', async () => {
  const { buildButtons, buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  const row = opportunity({ elapsedSec: 31, currentRoi: 9.89 });
  row.raw_data = mergeOpportunityMarketContext(row, {
    symbol: 'YOMOGI', name: 'Yomogi in Hood', address,
  }, 'NOT_INDEXED');
  const target: TokenOpenTarget = {
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}`,
    tokenSource: 'blockscout',
  };
  const message = buildOpportunityMessage(row);
  assert.match(message, /<b>YOMOGI<\/b> · <code>0x23e5…669cb<\/code>/);
  assert.match(message, /Market\s+<b>INDEXING<\/b>/);
  assert.match(message, /Market data is still indexing\./);
  assert.doesNotMatch(message, /Market cap|Liquidity|5m volume|\$0/);
  const buttons = buildButtons(row, target, { telegram_id: '1', tier: 'paid', is_admin: false } as any);
  assert.deepEqual(buttons[0].map(button => button.text), ['🔎 Token']);
  assert.equal(buttons.flat().some(button => button.text.includes('Trade')), false);
});

test('generic missing data and historical outcomes never claim market indexing', async () => {
  const { buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  const generic = opportunity({ elapsedSec: 31, symbol: 'YOMOGI' });
  assert.doesNotMatch(buildOpportunityMessage(generic), /INDEXING|still indexing/i);

  const historical = opportunity({ elapsedSec: 31, symbol: 'YOMOGI' });
  historical.recommended_action = 'EXIT';
  historical.raw_data = mergeOpportunityMarketContext(historical, {
    symbol: 'YOMOGI', name: 'Yomogi in Hood', address,
  }, 'NOT_INDEXED');
  assert.doesNotMatch(buildOpportunityMessage(historical), /INDEXING|still indexing/i);
});
