import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('dotenv/config');
const { buildPonsSustainedPresentation } = await import('../src/chains/robinhood/ponsShadowOutcomeTracker.js');

const address = '0x257012345678901234567890123456789008444e';
const observedAt = new Date().toISOString();

function valuation(valueUsd = 4_300) {
  return {
    tokenAddress: address, valueUsd, valuationType: 'FDV', indexed: false,
    source: 'PONS_V2_CURVE_RESERVE_SPOT', tokenPriceUsd: 0.0000043,
    tokenPriceSource: 'PONS_V2_CURVE_RESERVE_RATIO',
    quoteAsset: '0x4200000000000000000000000000000000000006', quoteUsd: 2500,
    quoteUsdSource: 'DEXSCREENER_ROBINHOOD_BASE_TOKEN_PRICE', observedAt,
  };
}

function build(overrides: Record<string, unknown> = {}) {
  return buildPonsSustainedPresentation({
    state: 'BUILDING', tokenAddress: address,
    detectedAt: new Date(Date.parse(observedAt) - 45_000).toISOString(),
    currentRoi: 6.4, peakRoi: 8.2, observedAt,
    opportunity: { id: 406, asset_id: address, chain: 'robinhood',
      strategy_key: 'PONS_IGNITION', risk_score: 22, raw_data: {} },
    rawData: { symbol: 'TOKEN', name: 'Token Name', identityVerifiedAt: observedAt,
      marketIndexState: 'NOT_INDEXED', preIndexValuation: valuation(),
      devHoldingPercent: 0, devHoldingEvidence: 'VERIFIED',
      totalBurnPercent: 0, burnEvidence: 'VERIFIED', ...overrides },
    target: { tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}` },
  });
}

test('BUILDING renders enriched verified pre-index context and mature PONS actions', () => {
  const result = build();
  assert.equal(result.eligibleForBuilding, true);
  assert.match(result.message, /📈 <b>ALPHAOS · BUILDING<\/b>/);
  assert.match(result.message, /<b>TOKEN<\/b> · <code>0x2570…8444e<\/code>/);
  assert.match(result.message, /Token Name/);
  assert.match(result.message, /⏱ Age\s+<b>45s<\/b>/);
  assert.match(result.message, /💰 FDV\s+<b>\$4\.30K<\/b>/);
  assert.match(result.message, /📈 Move\s+<b>\+6\.4%<\/b>/);
  assert.match(result.message, /🏔 Peak\s+<b>\+8\.2%<\/b>/);
  assert.match(result.message, /🛡 Retained\s+<b>78%<\/b>/);
  assert.match(result.message, /Dev holding\s+<b>0%<\/b>/);
  assert.match(result.message, /Burned\s+<b>0%<\/b>/);
  assert.match(result.message, /Risk\s+<b>LOW<\/b>/);
  assert.doesNotMatch(result.message, /Current ROI|Peak ROI|MEASURED|Market cap|Liquidity|5m volume/);
  assert.match(result.message, /🧠 <b>STRUCTURE<\/b>/);
  assert.match(result.message, /⏳ <b>STATUS<\/b>/);
  assert.deepEqual(result.actions.map(row => row.map(action => action.text)),
    [['🔬 Full Intel'], ['⭐ Track', '📋 Copy CA'], ['🔕 Mute']]);
  assert.equal(result.actions.flat().find(action => action.text === '📋 Copy CA')?.callback_data,
    `COPY_CA_${address}`);
  assert.equal(result.actions.flat().some(action => /Trade/.test(action.text)), false);
  for (const action of result.actions.flat()) {
    if (action.callback_data) assert.ok(Buffer.byteLength(action.callback_data, 'utf8') <= 64);
  }
});

test('indexed market replaces pre-index FDV and exposes only a verified direct chart', () => {
  const result = build({ marketIndexState: 'VERIFIED', marketCap: 18_400, fdv: 21_000,
    liquidity: 11_600, volume5m: 7_200, chartUrl: 'https://dexscreener.com/robinhood/pair' });
  assert.match(result.message, /💵 Market cap\s+<b>\$18\.4K<\/b>/);
  assert.match(result.message, /💧 Liquidity\s+<b>\$11\.6K<\/b>/);
  assert.match(result.message, /📊 5m volume\s+<b>\$7\.2K<\/b>/);
  assert.doesNotMatch(result.message, /FDV/);
  assert.equal(result.actions.flat().some(action => action.text === '🔎 Token'), false);

  const withVerifiedRoute = buildPonsSustainedPresentation({
    state: 'BUILDING', tokenAddress: address,
    detectedAt: new Date(Date.parse(observedAt) - 45_000).toISOString(), currentRoi: 6.4,
    peakRoi: 8.2, observedAt, opportunity: null,
    rawData: { symbol: 'TOKEN', marketCap: 18_400, liquidity: 11_600, volume5m: 7_200 },
    target: { tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}`,
      chartUrl: 'https://dexscreener.com/robinhood/pair' },
  });
  assert.deepEqual(withVerifiedRoute.actions.map(row => row.map(action => action.text)),
    [['🔬 Full Intel', '📊 Chart'], ['📋 Copy CA']]);
});

test('meaningless names and provenance-only risk are omitted while valid risk renders', () => {
  const measured = buildPonsSustainedPresentation({
    state: 'BUILDING', tokenAddress: address, detectedAt: observedAt, currentRoi: 2.6,
    peakRoi: 2.6, observedAt, opportunity: { id: 1, asset_id: address, chain: 'robinhood',
      strategy_key: 'PONS_IGNITION', risk_score: null, raw_data: { risk: 'MEASURED' } },
    rawData: { symbol: 'TOKEN', name: 'TOKEN' },
    target: { tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}` },
  });
  assert.doesNotMatch(measured.message, /MEASURED|Risk/);
  assert.equal(measured.eligibleForBuilding, true);
  assert.equal(measured.message.match(/TOKEN/g)?.length, 1);
  const high = buildPonsSustainedPresentation({
    state: 'BUILDING', tokenAddress: address, detectedAt: observedAt, currentRoi: 2.6,
    peakRoi: 2.6, observedAt, opportunity: { id: 1, asset_id: address, chain: 'robinhood',
      strategy_key: 'PONS_IGNITION', risk_score: 85, raw_data: {} },
    rawData: { symbol: 'TOKEN' },
    target: { tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}` },
  });
  assert.match(high.message, /Risk\s+<b>HIGH<\/b>/);

  const unidentified = buildPonsSustainedPresentation({
    state: 'BUILDING', tokenAddress: address, detectedAt: observedAt, currentRoi: 2.6,
    peakRoi: 2.6, observedAt, opportunity: null, rawData: {},
    target: { tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}` },
  });
  assert.equal(unidentified.eligibleForBuilding, false);
  const critical = build({ criticalSecurity: true });
  assert.equal(critical.eligibleForBuilding, false);
});

test('RUNNER uses enriched factual continuation language and ledger snapshot context', () => {
  const result = buildPonsSustainedPresentation({
    state: 'RUNNER', tokenAddress: address,
    detectedAt: new Date(Date.parse(observedAt) - 240_000).toISOString(),
    currentRoi: 46.7, peakRoi: 49.1, observedAt,
    opportunity: { id: 406, asset_id: address, chain: 'robinhood',
      strategy_key: 'PONS_BREAKOUT', risk_score: 22, raw_data: {} },
    rawData: { symbol: 'TOKEN', name: 'Token Name', marketIndexState: 'VERIFIED',
      marketCap: 31_200, liquidity: 15_400, volume5m: 22_800,
      devHoldingPercent: 2.1, devHoldingEvidence: 'VERIFIED',
      totalBurnPercent: 0, burnEvidence: 'VERIFIED' },
    target: { tokenUrl: `https://robinhoodchain.blockscout.com/token/${address}`,
      chartUrl: 'https://dexscreener.com/robinhood/pair' },
  });
  assert.match(result.message, /🔥 <b>ALPHAOS · RUNNER<\/b>/);
  assert.match(result.message, /🧠 <b>CONTINUATION<\/b>/);
  assert.match(result.message, /Confirmation survived a later checkpoint and price retained 95%/);
  assert.match(result.message, /🚀 <b>STATUS<\/b>/);
  assert.doesNotMatch(result.message, /BUY|Trade|Current ROI|Peak ROI/);
  assert.deepEqual({ symbol: result.snapshot.symbol, name: result.snapshot.name,
    marketCap: result.snapshot.marketCap, liquidity: result.snapshot.liquidity,
    volume5m: result.snapshot.volume5m, chartUrl: result.snapshot.chartUrl,
    retainedPeakPercent: result.snapshot.retainedPeakPercent },
  { symbol: 'TOKEN', name: 'Token Name', marketCap: 31_200, liquidity: 15_400,
    volume5m: 22_800, chartUrl: 'https://dexscreener.com/robinhood/pair', retainedPeakPercent: 95 });
});

test('an unchanged BUILDING state can mature once and then exits through semantic dedup', async () => {
  const source = await readFile(
    new URL('../src/chains/robinhood/ponsShadowOutcomeTracker.ts', import.meta.url), 'utf8');
  assert.match(source, /else if \(nextState !== 'BUILDING'\) return/);
  assert.match(source, /event_identity.*v2:BUILDING:/s);
  assert.match(source, /if \(existing\) return/);
  assert.match(source, /await persistAlphaSemanticEvent/);
  assert.doesNotMatch(source, /sendTelegram/);
});

test('PONS CHECK_ENTRY renders the premium OPPORTUNITY category without changing classification', async () => {
  const { buildOpportunityMessage } = await import('../src/services/opportunityDeliveryService.js');
  const message = buildOpportunityMessage({
    id: 407, asset_id: address, chain: 'robinhood', strategy_key: 'PONS_BREAKOUT',
    recommended_action: 'CHECK_ENTRY', status: 'NEW', title: 'PONS entry',
    why: 'Existing classifier confirmed entry.', what_happened: null, invalidation: null,
    risk_reason: null, confidence: 88, risk_score: 22,
    raw_data: { symbol: 'TOKEN', name: 'Token Name', elapsedSec: 35, currentRoi: 12,
      recentPeakRoi: 13, marketIndexState: 'VERIFIED', marketCap: 20_000,
      liquidity: 12_000, volume5m: 8_000, devHoldingPercent: 1.15,
      devHoldingEvidence: 'VERIFIED', totalBurnPercent: 0, burnEvidence: 'VERIFIED' },
  });
  assert.match(message, /🎯 <b>ENTRY OPPORTUNITY/);
  assert.match(message, /🎯 <b>ACTION: CHECK ENTRY/);
  assert.match(message, /📈 <b>WHY NOW<\/b>/);
  assert.match(message, /Volume and price structure remain constructive/);
  assert.match(message, /🧠 <b>AlphaOS:<\/b> OPPORTUNITY/);
  assert.doesNotMatch(message, /ROI|Trade/);
});
