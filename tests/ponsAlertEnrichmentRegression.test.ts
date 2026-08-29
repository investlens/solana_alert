import assert from 'node:assert/strict';
import test from 'node:test';

import type { TokenOpenTarget } from '../src/core/tokenOpenRouter.js';
import { mergePonsLifecycleContext } from '../src/product/opportunityContext.js';

const address = '0x23e516c1261af6f40e44abbecb29b22e192669cb';
const rustyAddress = '0xc48e455a4621bce424aa86b8e2d9e66f544e74d1';
const sixAddress = '0xa091487033b5f92df82563b26cdc0d9b80a36e9d';
const spurdoAddress = '0x26de761468a48b2f939d60755fe5413ee4a9c03e';
const ofyAddress = '0x6267b4147a553aa777c0fbd03112fbfd4dcb3106';

function spurdoValuation() {
  return {
    tokenAddress: spurdoAddress,
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
    feeBps: 100,
    creatorTaxBps: 0,
  };
}

function ofyValuation() {
  return {
    ...spurdoValuation(),
    tokenAddress: ofyAddress,
    valueUsd: 4109.5152,
    tokenPriceUsd: 0.0000041095152,
    quoteAsset: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    creatorTaxBps: 200,
  };
}

async function service() {
  await import('dotenv/config');
  return import('../src/services/opportunityDeliveryService.js');
}

async function ponsResolver() {
  await import('dotenv/config');
  return import('../src/services/ponsDeliveryContext.js');
}

function opportunity(raw_data: Record<string, unknown>, asset_id = address) {
  return {
    id: 406, asset_id, chain: 'robinhood', strategy_key: 'PONS_BREAKOUT',
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
  assert.deepEqual(buttons[0].map(button => button.text), ['🔬 Full Intel', '📊 Chart']);
  assert.equal(buttons.flat().some(button => button.text === '🔎 Token'), false);
  assert.equal(buttons.flat().some(button => button.text.includes('Trade')), false);
});

test('fresh verified PONS identity with confirmed market miss omits unavailable market values', async () => {
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
  assert.doesNotMatch(message, /Market\s+<b>INDEXING<\/b>/);
  assert.doesNotMatch(message, /still indexing/i);
  assert.doesNotMatch(message, /Market cap|Liquidity|5m volume|\$0/);
  const buttons = buildButtons(row, target, { telegram_id: '1', tier: 'paid', is_admin: false } as any);
  assert.deepEqual(buttons[0].map(button => button.text), ['🔬 Full Intel']);
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

test('RUSTY identity survives Entry Ready persistence and a symbol-less Exit transition', async () => {
  const { buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  const entry = opportunity({ elapsedSec: 75, currentRoi: 6.13, roiChange: 5.62 }, rustyAddress);
  entry.raw_data = mergeOpportunityMarketContext(entry, {
    symbol: 'RUSTY', name: 'Rusty', address: rustyAddress,
  }, 'NOT_INDEXED');
  assert.match(buildOpportunityMessage(entry), /<b>RUSTY<\/b>/);
  assert.doesNotMatch(buildOpportunityMessage(entry), /Market\s+<b>INDEXING<\/b>/);

  const exitRaw = mergePonsLifecycleContext(entry.raw_data, {
    symbol: null, name: null, marketCap: null, liquidity: null, volume5m: null,
    elapsedSec: 215, currentRoi: -29.67, roiChange: -34,
    ponsAlphaState: 'FADING', source: 'PONS_ALPHA_CLASSIFIER',
  });
  const exit = { ...opportunity(exitRaw, rustyAddress), recommended_action: 'EXIT', confidence: 80, risk_score: 90 };
  const message = buildOpportunityMessage(exit);
  assert.match(message, /<b>RUSTY<\/b> · <code>0xc48e…e74d1<\/code>/);
  assert.doesNotMatch(message, /INDEXING|still indexing/i);
});

test('lifecycle merge protects verified identity but accepts a stronger verified replacement', () => {
  const existing = {
    symbol: 'RUSTY', name: 'Rusty', identityVerifiedAt: '2026-08-23T13:56:00.000Z',
    identitySource: 'ROBINHOOD_ONCHAIN_METADATA', marketIndexState: 'NOT_INDEXED',
  };
  const missing = mergePonsLifecycleContext(existing, { symbol: 'UNKNOWN', name: '', currentRoi: -2 });
  assert.equal(missing.symbol, 'RUSTY');
  assert.equal(missing.name, 'Rusty');

  const replacement = mergePonsLifecycleContext(existing, {
    symbol: 'RUSTY2', name: 'Rusty Two', identityVerifiedAt: '2026-08-23T13:57:00.000Z',
    identitySource: 'ROBINHOOD_MARKET_SNAPSHOT',
  });
  assert.equal(replacement.symbol, 'RUSTY2');
  assert.equal(replacement.name, 'Rusty Two');
});

test('stale market observations remain auditable but are not presented as current', async () => {
  const { buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  const entry = opportunity({ elapsedSec: 75 });
  entry.raw_data = mergeOpportunityMarketContext(entry, {
    symbol: 'RUSTY', marketCap: 80_000, liquidity: 20_000, volume5m: 5_000,
    chartUrl: 'https://dexscreener.com/robinhood/rusty',
  }, 'VERIFIED');
  const later = mergePonsLifecycleContext(entry.raw_data, {
    symbol: null, marketCap: null, liquidity: null, volume5m: null,
    elapsedSec: 215, currentRoi: -29.67,
  });
  assert.ok(later.verifiedMarketContext);
  const exit = { ...opportunity(later), recommended_action: 'EXIT' };
  assert.doesNotMatch(buildOpportunityMessage(exit), /Market cap|Liquidity|5m volume/);
});

test('opportunity specialist zeroes require explicit meaningful confirmation', async () => {
  const { buildOpportunityMessage } = await service();
  const unconfirmed = buildOpportunityMessage(opportunity({
    symbol: 'RUSTY', elapsedSec: 31, otherDevTransferPercent: 0,
    devHoldingPercent: 0, totalBurnPercent: 0,
  }));
  assert.doesNotMatch(unconfirmed, /Transferred|Dev holding|Burned\s/);

  const confirmed = buildOpportunityMessage(opportunity({
    symbol: 'RUSTY', elapsedSec: 31, otherDevTransferPercent: 0,
    devHoldingPercent: 0, totalBurnPercent: 0, devFlowEvidenceStatus: 'COMPLETE',
    transferZeroConfirmedMeaningful: true,
  }));
  assert.doesNotMatch(confirmed, /Transferred/);
  assert.match(confirmed, /Dev:<\/b> Holds 0%/);
  assert.doesNotMatch(confirmed, /Dev:<\/b>[^\n]*Burned/);
});

test('Entry to Exit preserves verified developer holding and burn but not stale market cap', async () => {
  const { buildOpportunityMessage } = await service();
  const entryEvidence = {
    symbol: 'RUSTY', identityVerifiedAt: '2026-08-23T13:56:00.000Z',
    devHoldingPercent: 2.86, devHoldingEvidence: 'VERIFIED',
    devHoldingSource: 'ROBINHOOD_DEV_TOKEN_FLOW', devHoldingObservedAt: '2026-08-23T13:56:01.000Z',
    totalBurnPercent: 12.4, burnEvidence: 'VERIFIED',
    burnSource: 'ROBINHOOD_DEAD_AND_ZERO_BALANCES', burnObservedAt: '2026-08-23T13:56:01.000Z',
    marketCap: 80_000, marketIndexState: 'VERIFIED',
  };
  const exitRaw = mergePonsLifecycleContext(entryEvidence, {
    symbol: null, devHoldingPercent: null, totalBurnPercent: null, marketCap: null,
    elapsedSec: 215, currentRoi: -29.67, roiChange: -34,
  });
  const exit = { ...opportunity(exitRaw, rustyAddress), recommended_action: 'EXIT' };
  const message = buildOpportunityMessage(exit);
  assert.doesNotMatch(message, /Dev holding|Burned/);
  assert.doesNotMatch(message, /Market cap/);
});

test('production SIX Exit resolves bounded metadata when no Entry identity was persisted', async () => {
  const { buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const exit = {
    ...opportunity({ elapsedSec: 125, currentRoi: -4.63, roiChange: -28.29 }, sixAddress),
    recommended_action: 'EXIT', confidence: 80, risk_score: 90,
  };
  let metadataFallbackRequested = false;
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => null,
    loadObservationIdentity: async () => null,
    loadPreIndexValuation: async () => null,
    resolveTarget: async input => {
      metadataFallbackRequested = input.includeMetadataFallback === true;
      return {
        tokenUrl: `https://robinhoodchain.blockscout.com/token/${sixAddress}`,
        tokenSource: 'blockscout',
        marketContext: { symbol: 'SIX', name: '6-EYES', address: sixAddress },
      };
    },
  });
  assert.equal(metadataFallbackRequested, true);
  exit.raw_data = mergeOpportunityMarketContext(exit, resolved.target.marketContext);
  const message = buildOpportunityMessage(exit);
  assert.match(message, /<b>SIX<\/b> · <code>0xa091…36e9d<\/code>/);
  assert.doesNotMatch(message, /INDEXING|Market cap|Liquidity|5m volume/);
});

test('metadata failure safely leaves Exit address-only', async () => {
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const exit = {
    ...opportunity({ elapsedSec: 125, currentRoi: -4.63 }, sixAddress),
    recommended_action: 'EXIT',
  };
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => null,
    loadObservationIdentity: async () => null,
    loadPreIndexValuation: async () => null,
    resolveTarget: async () => ({
      tokenUrl: `https://robinhoodchain.blockscout.com/token/${sixAddress}`,
      tokenSource: 'blockscout',
    }),
  });
  assert.equal(resolved.rawData.symbol, undefined);
  const { buildOpportunityMessage } = await service();
  assert.match(buildOpportunityMessage(exit), /RISK ACTION[\s\S]*0xa091…36e9d<\/b>[\s\S]*ACTION: EXIT/);
});

test('persisted lifecycle identity prevents unnecessary metadata fallback', async () => {
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const exit = {
    ...opportunity({ elapsedSec: 125, symbol: null, name: null }, sixAddress),
    recommended_action: 'EXIT',
  };
  let includeMetadataFallback: boolean | undefined;
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => ({
      symbol: 'SIX', name: '6-EYES', identityVerifiedAt: '2026-08-23T14:20:20.000Z',
      identitySource: 'ROBINHOOD_ONCHAIN_METADATA',
    }),
    loadObservationIdentity: async () => { throw new Error('observation lookup should be skipped'); },
    loadPreIndexValuation: async () => null,
    resolveTarget: async input => {
      includeMetadataFallback = input.includeMetadataFallback;
      return {
        tokenUrl: `https://robinhoodchain.blockscout.com/token/${sixAddress}`,
        tokenSource: 'blockscout',
      };
    },
  });
  assert.equal(includeMetadataFallback, false);
  assert.equal(resolved.rawData.symbol, 'SIX');
});

test('Exit uses only a verified current market snapshot for metrics and Chart', async () => {
  const { buildButtons, buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  const exit = {
    ...opportunity({ elapsedSec: 125 }, sixAddress), recommended_action: 'EXIT',
  };
  const target: TokenOpenTarget = {
    chartUrl: 'https://dexscreener.com/robinhood/six',
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${sixAddress}`,
    chartSource: 'dexscreener', tokenSource: 'blockscout', marketIndexState: 'VERIFIED',
    marketContext: { symbol: 'SIX', name: '6-EYES', address: sixAddress,
      marketCap: 70_000, liquidity: 18_000, volume5m: 4_500,
      chartUrl: 'https://dexscreener.com/robinhood/six' },
  };
  exit.raw_data = mergeOpportunityMarketContext(exit, target.marketContext, 'VERIFIED');
  const message = buildOpportunityMessage(exit);
  assert.match(message, /Market cap\s+<b>\$70\.0K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$18\.0K<\/b>/);
  assert.match(message, /5m volume\s+<b>\$4\.5K<\/b>/);
  assert.doesNotMatch(message, /INDEXING/);
  const buttons = buildButtons(exit, target, { telegram_id: '1', tier: 'paid', is_admin: false } as any);
  assert.deepEqual(buttons[0].map(button => button.text), ['🔬 Full Intel', '📊 Chart']);
  assert.equal(buttons.flat().some(button => button.text.includes('Trade')), false);
  for (const button of buttons.flat()) {
    if (button.callback_data) assert.ok(Buffer.byteLength(button.callback_data, 'utf8') <= 64);
  }
});

test('SPURDO persisted lifecycle data reaches final Exit rendering and Copy CA actions', async () => {
  const { buildButtons, buildOpportunityMessage } = await service();
  const exit = {
    ...opportunity({
      symbol: 'SPURDO', name: 'SPURDO', elapsedSec: 180,
      currentRoi: -18.4, roiChange: -26.2,
      marketCap: null, liquidity: null, volume5m: null,
      marketIndexState: 'NOT_INDEXED', preIndexValuation: spurdoValuation(),
      devHoldingEvidence: 'VERIFIED', devHoldingPercent: 0,
      burnEvidence: 'VERIFIED', totalBurnPercent: 0,
      otherDevTransferPercent: 3.62, devFlowEvidenceStatus: 'COMPLETE',
    }, spurdoAddress),
    recommended_action: 'EXIT', confidence: 80, risk_score: 90,
  };
  const target: TokenOpenTarget = {
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${spurdoAddress}`,
    tokenSource: 'blockscout',
  };
  const message = buildOpportunityMessage(exit);
  assert.match(message, /<b>SPURDO<\/b>/);
  assert.match(message, /FDV\s+<b>\$4\.(?:58|6)K<\/b>/);
  assert.doesNotMatch(message, /Dev holding|Burned/);
  assert.doesNotMatch(message, /Market INDEXING|Market cap|Liquidity|5m volume/);

  const buttons = buildButtons(exit, target, { telegram_id: '1', tier: 'paid', is_admin: false } as any);
  assert.equal(buttons.flat().some(button => button.text.includes('Trade')), false);
  assert.deepEqual(buttons[0].map(button => button.text), ['🔬 Full Intel']);
  const copy = buttons.flat().find(button => button.text === '📋 Copy CA');
  assert.equal(copy?.callback_data, `COPY_CA_${spurdoAddress}`);
  assert.ok(Buffer.byteLength(copy!.callback_data!, 'utf8') <= 64);
});

test('PONS Entry Ready and Watching render verified FDV while indexed market replaces it', async () => {
  const { buildOpportunityMessage } = await service();
  for (const action of ['CHECK_ENTRY', 'TRACK', 'WATCH']) {
    const row = {
      ...opportunity({ symbol: 'SPURDO', elapsedSec: 60, marketIndexState: 'NOT_INDEXED',
        preIndexValuation: spurdoValuation() }, spurdoAddress),
      recommended_action: action,
    };
    assert.match(buildOpportunityMessage(row), /FDV\s+<b>\$4\.(?:58|6)K<\/b>/);
    assert.doesNotMatch(buildOpportunityMessage(row), /Market\s+<b>INDEXING<\/b>/);
  }

  const indexed = {
    ...opportunity({
      symbol: 'SPURDO', elapsedSec: 60, marketIndexState: 'VERIFIED',
      marketCap: 8_200, liquidity: 3_100, volume5m: 900,
      chartUrl: 'https://dexscreener.com/robinhood/spurdo',
      preIndexValuation: spurdoValuation(),
    }, spurdoAddress),
    recommended_action: 'EXIT',
  };
  const message = buildOpportunityMessage(indexed);
  assert.match(message, /Market cap\s+<b>\$8\.2K<\/b>/);
  assert.doesNotMatch(message, /FDV|verified launch curve|INDEXING/);
});

test('same-token lifecycle valuation is recovered even when Exit identity is already complete', async () => {
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const exit = {
    ...opportunity({ symbol: 'SPURDO', name: 'SPURDO', elapsedSec: 180 }, spurdoAddress),
    recommended_action: 'EXIT',
  };
  let lifecycleLookedUp = false;
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => {
      lifecycleLookedUp = true;
      return { symbol: 'SPURDO', preIndexValuation: spurdoValuation() };
    },
    loadObservationIdentity: async () => null,
    resolveTarget: async () => ({
      tokenUrl: `https://robinhoodchain.blockscout.com/token/${spurdoAddress}`,
      tokenSource: 'blockscout',
    }),
  });
  assert.equal(lifecycleLookedUp, true);
  assert.ok(resolved.rawData.preIndexValuation);
  const { buildOpportunityMessage } = await service();
  exit.raw_data = resolved.rawData;
  assert.match(buildOpportunityMessage(exit), /FDV\s+<b>\$4\.(?:58|6)K<\/b>/);
});

test('OFY V2 Exit retries verified curve FDV when lifecycle and Dex context are empty', async () => {
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const { buildButtons, buildOpportunityMessage } = await service();
  const exit = {
    ...opportunity({
      symbol: 'OFY', name: 'OffYield', elapsedSec: 135,
      currentRoi: -26.930228436484715, roiChange: -22.980829294790144,
      marketIndexState: 'NOT_INDEXED', preIndexValuation: null,
      devHoldingPercent: 0, devHoldingEvidence: 'VERIFIED',
      totalBurnPercent: 0, burnEvidence: 'VERIFIED',
      otherDevTransferPercent: 3, devFlowEvidenceStatus: 'COMPLETE',
    }, ofyAddress),
    strategy_key: 'PONS_RISK', recommended_action: 'EXIT', confidence: 80, risk_score: 90,
  };
  const target: TokenOpenTarget = {
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${ofyAddress}`,
    tokenSource: 'blockscout', marketIndexState: 'NOT_INDEXED',
  };
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => ({ symbol: 'OFY', name: 'OffYield' }),
    loadObservationIdentity: async () => null,
    loadPreIndexValuation: async () => ({ preIndexValuation: ofyValuation() }),
    resolveTarget: async () => target,
  });
  exit.raw_data = resolved.rawData;
  const message = buildOpportunityMessage(exit);
  assert.match(message, /<b>OFY<\/b> · <code>0x6267…b3106<\/code>/);
  assert.match(message, /FDV\s+<b>\$4\.(?:11|1)K<\/b>/);
  assert.doesNotMatch(message, /Market cap|Market\s+<b>INDEXING|Liquidity|5m volume/);
  const buttons = buildButtons(exit, target, { telegram_id: '1', tier: 'paid', is_admin: false } as any);
  assert.deepEqual(buttons.map(row => row.map(button => button.text)), [
    ['🔬 Full Intel'], ['⭐ Track', '📋 Copy CA'], ['🔕 Mute'],
  ]);
  assert.equal(buttons[1][1].callback_data, `COPY_CA_${ofyAddress}`);
  assert.equal(buttons.flat().some(button => button.text.includes('Trade')), false);
});

test('OFY lifecycle keeps verified FDV while indexed current market takes precedence', async () => {
  const { buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  let raw: Record<string, unknown> = {
    symbol: 'OFY', name: 'OffYield', marketIndexState: 'NOT_INDEXED',
    preIndexValuation: ofyValuation(), elapsedSec: 30,
  };
  for (const action of ['CHECK_ENTRY', 'TRACK', 'EXIT']) {
    const row = { ...opportunity(raw, ofyAddress), recommended_action: action };
    assert.match(buildOpportunityMessage(row), /FDV\s+<b>\$4\.(?:11|1)K<\/b>/);
    raw = mergePonsLifecycleContext(raw, { ...raw, elapsedSec: Number(raw.elapsedSec) + 45 });
  }
  const indexed = { ...opportunity(raw, ofyAddress), recommended_action: 'EXIT' };
  indexed.raw_data = mergeOpportunityMarketContext(indexed, {
    symbol: 'OFY', marketCap: 9_000, fdv: 10_000, liquidity: 3_000, volume5m: 800,
    chartUrl: 'https://dexscreener.com/robinhood/ofy',
  }, 'VERIFIED');
  const message = buildOpportunityMessage(indexed);
  assert.match(message, /Market cap\s+<b>\$9\.0K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$3\.0K<\/b>/);
  assert.match(message, /5m volume\s+<b>\$800<\/b>/);
  assert.doesNotMatch(message, /FDV|verified launch curve|INDEXING/);
});

test('PONS V1 without indexed market or defensible valuation remains truthfully unavailable', async () => {
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const { buildOpportunityMessage } = await service();
  const exit = {
    ...opportunity({ symbol: 'VONE', elapsedSec: 120, marketIndexState: 'NOT_INDEXED' }, ofyAddress),
    strategy_key: 'PONS_RISK', recommended_action: 'EXIT',
  };
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => null,
    loadObservationIdentity: async () => null,
    loadPreIndexValuation: async () => null,
    resolveTarget: async () => ({
      tokenUrl: `https://robinhoodchain.blockscout.com/token/${ofyAddress}`,
      tokenSource: 'blockscout', marketIndexState: 'NOT_INDEXED',
    }),
  });
  exit.raw_data = resolved.rawData;
  assert.doesNotMatch(buildOpportunityMessage(exit), /Market cap|FDV|Liquidity|5m volume|INDEXING/);
});
