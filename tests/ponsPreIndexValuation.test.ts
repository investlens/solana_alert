import assert from 'node:assert/strict';
import test from 'node:test';

import { PONS_CONTRACTS } from '../src/chains/robinhood/ponsContracts.js';
import {
  derivePonsV2PreIndexValuation,
  type VerifiedPonsPreIndexValuation,
} from '../src/chains/robinhood/ponsPreIndexValuation.js';
import {
  chooseBestRobinhoodPair,
  selectVerifiedQuoteUsdObservation,
  type QuoteUsdObservation,
} from '../src/chains/robinhood/market.js';

const token = '0x1111111111111111111111111111111111111111';
const curve = '0x2222222222222222222222222222222222222222';
const now = Date.now();

async function buildMessage(value: ReturnType<typeof opportunity>): Promise<string> {
  await import('dotenv/config');
  const { buildOpportunityMessage } = await import('../src/services/opportunityDeliveryService.js');
  return buildOpportunityMessage(value);
}

const curveState = {
  curveAddress: curve,
  tokenAddress: token,
  pairToken: '0x0000000000000000000000000000000000000000',
  nativeQuote: true,
  quoteReserve: 10n * 10n ** 18n,
  tokenReserve: 500_000n * 10n ** 18n,
  reservedTokens: 100_000n * 10n ** 18n,
  sellableTokens: 400_000n * 10n ** 18n,
  feeBps: 100n,
  creatorTaxBps: 50n,
  graduated: false,
} as any;

const tokenMetadata = {
  address: token,
  name: 'Curve Token', symbol: 'CURVE', decimals: 18,
  totalSupplyRaw: 1_000_000n * 10n ** 18n,
  bytecodeExists: true, readErrors: [],
} as any;

function quoteUsd(overrides: Partial<QuoteUsdObservation> = {}): QuoteUsdObservation {
  return {
    state: 'VERIFIED', quoteAddress: PONS_CONTRACTS.weth,
    usdPrice: 3_000, source: 'DEXSCREENER_ROBINHOOD_BASE_TOKEN_PRICE',
    observedAt: new Date(now).toISOString(), ...overrides,
  };
}

function opportunity(args: {
  action?: string;
  valuation?: VerifiedPonsPreIndexValuation | null;
  indexed?: boolean;
  marketCap?: number | null;
  fdv?: number | null;
}) {
  return {
    id: 801, asset_id: token, chain: 'robinhood', opportunity_type: 'PONS_ALPHA',
    source_agent: 'PonsAlpha', title: 'PONS', why: 'Curve momentum confirmed.',
    what_happened: null, invalidation: null, risk_reason: null, confidence: 84,
    expected_profit: null, expected_profit_percent: null, risk_score: 20,
    status: 'NEW', recommended_action: args.action ?? 'BUY', strategy_key: 'PONS_BREAKOUT',
    revision: 1, updated_at: new Date(now).toISOString(), expires_at: null,
    raw_data: {
      symbol: 'CURVE', name: 'Curve Token', elapsedSec: 18,
      currentRoi: 6.2, roiChange: 8.1,
      marketCap: args.marketCap ?? null, fdv: args.fdv ?? null,
      marketIndexState: args.indexed ? 'VERIFIED' : 'NOT_INDEXED',
      preIndexValuation: args.valuation ?? null,
      devHoldingPercent: 2.4, devHoldingEvidence: 'VERIFIED',
      totalBurnPercent: 3.1, burnEvidence: 'VERIFIED',
    },
  } as any;
}

test('V2 verified curve price and quote/USD render FDV without relabeling it', async () => {
  const valuation = derivePonsV2PreIndexValuation({
    curveState, tokenMetadata, quoteUsd: quoteUsd(), now,
  });
  assert.ok(valuation);
  assert.equal(valuation.valuationType, 'FDV');
  assert.equal(Math.round(valuation.valueUsd), 60_000);
  assert.equal(valuation.feeBps, 100);
  assert.equal(valuation.creatorTaxBps, 50);

  const message = await buildMessage(opportunity({ valuation }));
  assert.match(message, /FDV\s+<b>\$60\.0K<\/b>/);
  assert.doesNotMatch(message, /Market cap/);
  assert.doesNotMatch(message, /Market\s+<b>INDEXING<\/b>/);
  assert.match(message, /Dev holding\s+<b>2\.4%<\/b>/);
  assert.match(message, /Burned\s+<b>3\.1%<\/b>/);
});

test('verified circulating supply changes V2 valuation label to Market cap', async () => {
  const valuation = derivePonsV2PreIndexValuation({
    curveState, tokenMetadata, quoteUsd: quoteUsd(),
    circulatingSupplyRaw: 700_000n * 10n ** 18n, now,
  });
  assert.ok(valuation);
  assert.equal(valuation.valuationType, 'MARKET_CAP');
  assert.equal(Math.round(valuation.valueUsd), 42_000);
  const message = await buildMessage(opportunity({ valuation }));
  assert.match(message, /Market cap\s+<b>\$42\.0K<\/b>/);
  assert.doesNotMatch(message, /FDV/);
});

test('missing, stale, or mismatched quote/USD evidence cannot produce valuation', async () => {
  assert.equal(derivePonsV2PreIndexValuation({
    curveState, tokenMetadata,
    quoteUsd: quoteUsd({ state: 'UNAVAILABLE', usdPrice: null, source: null }), now,
  }), null);
  assert.equal(derivePonsV2PreIndexValuation({
    curveState, tokenMetadata,
    quoteUsd: quoteUsd({ observedAt: new Date(now - 180_000).toISOString() }), now,
  }), null);
  assert.equal(derivePonsV2PreIndexValuation({
    curveState, tokenMetadata,
    quoteUsd: quoteUsd({ quoteAddress: '0x3333333333333333333333333333333333333333' }), now,
  }), null);
  assert.equal(derivePonsV2PreIndexValuation({
    curveState, tokenMetadata: { ...tokenMetadata, address: '0x4444444444444444444444444444444444444444' },
    quoteUsd: quoteUsd(), now,
  }), null);

  const indexing = await buildMessage(opportunity({ valuation: null }));
  assert.doesNotMatch(indexing, /Market\s+<b>INDEXING<\/b>/);
});

test('quote/USD selection rejects a pair whose base token is not the requested quote asset', () => {
  const observation = selectVerifiedQuoteUsdObservation({
    quoteAddress: PONS_CONTRACTS.weth,
    observedAt: new Date(now),
    pairs: [{
      chainId: 'robinhood', baseToken: { address: token, symbol: 'WRONG' },
      quoteToken: { address: PONS_CONTRACTS.weth }, priceUsd: '3000',
      liquidity: { usd: 1_000_000 },
    }],
  });
  assert.equal(observation.state, 'UNAVAILABLE');
  assert.equal(chooseBestRobinhoodPair([{
    chainId: 'robinhood', baseToken: { address: token }, priceUsd: '1',
    liquidity: { usd: 1_000_000 },
  }], PONS_CONTRACTS.weth), null);
});

test('indexed current market context overrides pre-index valuation', async () => {
  const valuation = derivePonsV2PreIndexValuation({
    curveState, tokenMetadata, quoteUsd: quoteUsd(), now,
  });
  assert.ok(valuation);
  const message = await buildMessage(opportunity({
    valuation, indexed: true, marketCap: 75_000, fdv: 90_000,
  }));
  assert.match(message, /Market cap\s+<b>\$75\.0K<\/b>/);
  assert.doesNotMatch(message, /FDV/);
  assert.doesNotMatch(message, /verified launch curve/);
});

test('Exit shows a fresh verified lifecycle valuation but never INDEXING', async () => {
  const valuation = derivePonsV2PreIndexValuation({
    curveState, tokenMetadata, quoteUsd: quoteUsd(), now,
  });
  assert.ok(valuation);
  const message = await buildMessage(opportunity({ action: 'EXIT', valuation }));
  assert.doesNotMatch(message, /INDEXING|Market cap/);
  assert.match(message, /FDV\s+<b>\$60\.0K<\/b>/);
  assert.match(message, /Dev holding\s+<b>2\.4%<\/b>/);
  assert.match(message, /Burned\s+<b>3\.1%<\/b>/);
});
