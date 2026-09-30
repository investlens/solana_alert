import assert from 'node:assert/strict';
import test from 'node:test';

import { boostMetadataFallback } from '../src/chains/robinhood/boostMetadataResolver.js';
import { buildPremiumTokenNotification } from '../src/ui/premiumTokenNotification.js';

const address = '0xA8936B7148EFDA48226DE8c06706c8f7b0f85C98';
const emptyMarket = {
  symbol: null,
  name: 'CloakSwap',
  address,
  price: null,
  marketCap: null,
  fdv: null,
  liquidity: null,
  volume5m: null,
  chartUrl: null,
};

test('boost metadata fallback never turns a contract address into a ticker', () => {
  const fallback = boostMetadataFallback(address);
  assert.equal(fallback.symbol, null);
  assert.equal(fallback.name, null);
});

test('boost cards keep required unknown fields visible and do not render CA as ticker', () => {
  const message = buildPremiumTokenNotification({
    state: 'BOOST',
    symbol: address,
    name: 'CloakSwap',
    address,
    chain: 'robinhood',
    launchSource: 'UNKNOWN',
    market: emptyMarket,
    boostTotal: 10,
    boostIncrement: 10,
    insightTitle: 'WHY NOW',
    insight: ['Boost verified after security gate'],
    statusTitle: 'Security',
    status: 'VERIFIED',
    displayIntent: 'WATCH',
  });

  assert.match(message, /Launch:<\/b> UNVERIFIED/);
  assert.match(message, /CloakSwap<\/b> · Symbol unavailable/);
  assert.doesNotMatch(message, /\$0xA8936B/i);
  assert.match(message, /Market cap<\/b>\s+Unavailable/);
  assert.match(message, /Liquidity<\/b>\s+Unavailable/);
  assert.match(message, /Dev holding<\/b>\s+Unverified/);
  assert.match(message, /Burned<\/b>\s+Unverified/);
  assert.match(message, /10 total \(\+10\)/);
});

test('boost cards render verified market, dev holding and burn evidence when available', () => {
  const message = buildPremiumTokenNotification({
    state: 'BOOST',
    symbol: 'AGI',
    name: 'Artificial Gato Intelligence',
    address,
    chain: 'robinhood',
    launchSource: 'PONS',
    market: {
      ...emptyMarket,
      symbol: 'AGI',
      name: 'Artificial Gato Intelligence',
      marketCap: 51_751,
      liquidity: 27_850,
      volume5m: 38_200,
    },
    evidence: {
      devHoldingPercent: 4.25,
      devHoldingEvidence: 'VERIFIED',
      burnedPercent: 1.5,
      burnEvidence: 'VERIFIED',
    },
    boostTotal: 100,
    boostIncrement: 100,
    insightTitle: 'WHY NOW',
    insight: ['Boost verified after security gate'],
    statusTitle: 'Security',
    status: 'VERIFIED',
    displayIntent: 'WATCH',
  });

  assert.match(message, /Launch:<\/b> PONS/);
  assert.match(message, /\$AGI<\/b> · Artificial Gato Intelligence/);
  assert.match(message, /Market cap<\/b>\s+\$51\.8K/);
  assert.match(message, /Liquidity<\/b>\s+\$27\.9K/);
  assert.match(message, /5m volume<\/b>\s+\$38\.2K/);
  assert.match(message, /Dev holding<\/b>\s+4\.25%/);
  assert.match(message, /Burned<\/b>\s+1\.5%/);
});
