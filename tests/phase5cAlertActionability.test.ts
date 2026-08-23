import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveTokenExplorerUrl, resolveTokenOpenTarget } from '../src/core/tokenOpenRouter.js';
import { describeMetricComparison } from '../src/product/metricComparison.js';
import { assertAlphaActions } from '../src/ui/alphaNotification.js';

async function opportunityMessage(rawData: Record<string, unknown>) {
  await import('dotenv/config');
  const { buildOpportunityMessage } = await import('../src/services/opportunityDeliveryService.js');
  return buildOpportunityMessage(opportunity(rawData));
}

const opportunity = (rawData: Record<string, unknown>) => ({
  id: 42,
  asset_id: 'TokenMint111111111111111111111111111111111',
  chain: 'solana',
  strategy_key: 'SOL_MOMENTUM',
  recommended_action: 'BUY',
  status: 'NEW',
  title: 'Solana Momentum: ABC',
  why: 'Momentum and market quality aligned.',
  what_happened: null,
  invalidation: null,
  risk_reason: null,
  confidence: 82,
  risk_score: 30,
  raw_data: rawData,
});

test('Solana chart and token actions route directly without copy/paste', async () => {
  const target = await resolveTokenOpenTarget({
    chain: 'solana', tokenAddress: 'Mint<&>123',
  });
  assert.equal(target.chartUrl, 'https://dexscreener.com/solana/Mint%3C%26%3E123');
  assert.equal(target.tokenUrl, 'https://solscan.io/token/Mint%3C%26%3E123');
});

test('chain-aware explorer routing never sends PONS to a Solana destination', () => {
  assert.equal(
    resolveTokenExplorerUrl('pons', '0xToken'),
    'https://robinhoodchain.blockscout.com/token/0xToken',
  );
  assert.doesNotMatch(resolveTokenExplorerUrl('robinhood', '0xToken'), /solscan|jup\.ag/i);
});

test('opportunity alert includes reliable market cap, liquidity and token identity', async () => {
  const message = await opportunityMessage({
    symbol: 'ABC<&>', marketCap: 48_200, liquidity: 12_500,
  });
  assert.match(message, /ABC&lt;&amp;&gt;.*TokenM…11111/);
  assert.match(message, /Market cap\s+<b>\$48\.2K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$12\.5K<\/b>/);
});

test('unavailable market cap and liquidity are omitted and never fabricated as zero', async () => {
  const message = await opportunityMessage({ symbol: 'ABC', marketCap: 0, liquidity: null });
  assert.doesNotMatch(message, /Market cap|Liquidity|\$0/);
});

test('metric comparison uses directionally correct language', () => {
  assert.equal(describeMetricComparison('ROI', 1, 5), 'ROI accelerated from +1.00% to +5.00%.');
  assert.equal(describeMetricComparison('ROI', 7.46, 5.29), 'ROI cooled from +7.46% to +5.29%.');
  assert.equal(describeMetricComparison('ROI', 5, -2), 'ROI reversed negative from +5.00% to -2.00%.');
  assert.equal(describeMetricComparison('ROI', -7.53, 9.89), 'ROI turned positive after an earlier dip.');
  assert.equal(describeMetricComparison('ROI', null, 3), 'ROI is +3.00%.');
  assert.doesNotMatch(describeMetricComparison('ROI', 7.46, 5.29), /improved/);
});

test('action grammar is ordered and PONS has no Solana execution action', async () => {
  const source = await readFile(new URL('../src/services/opportunityDeliveryService.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf("text:\n          '⚡ Trade'") < source.indexOf('const marketActions'));
  assert.ok(source.indexOf('const marketActions') < source.indexOf('const preferenceActions'));
  assert.match(source, /executionAvailable[\s\S]*\.toLowerCase\(\) ===[\s\S]*'solana'/);
  assert.doesNotMatch(source, /robinhood[\s\S]{0,180}OPP_TRADE_/i);
});

test('all representative alert callbacks remain within Telegram limit', () => {
  assert.doesNotThrow(() => assertAlphaActions([
    [{ text: 'Trade', callback_data: 'OPP_TRADE_42' }],
    [{ text: 'Track', callback_data: 'OPP_TRACK_42' }, { text: 'Mute', callback_data: 'STRAT_TOGGLE_SOL_MOMENTUM' }],
  ]));
});
