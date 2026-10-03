import assert from 'node:assert/strict';
import test from 'node:test';
import { assessArcForAlert } from '../src/chains/arc/alertGate.js';
import { arcBoostSafetyFromEvidence } from '../src/chains/arc/boostSafety.js';

const market: Parameters<typeof assessArcForAlert>[0] = {
  chain: 'arc', source: 'uniswap_v4', assetId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  quoteAsset: '0x0000000000000000000000000000000000000000', poolId: '0x1111', transactionHash: '0x2222',
  blockNumber: 1n, fee: 3000, tickSpacing: 60, name: 'Test', symbol: 'TEST', decimals: 18,
  totalSupplyRaw: 1000000n, eligibleForScoring: true, marketDataSource: 'DEXSCREENER',
  marketCapUsd: null, priceUsd: 0.01, pairCreatedAt: Date.now(), dexUrl: null,
  projectWebsite: null, projectTwitter: null, projectTelegram: null, safetyReasons: [], contractCodePresent: true, metadataReadable: true,
  hooks: '0x0000000000000000000000000000000000000000', liquidityUsd: 100000,
  volume5mUsd: 100000, buys5m: 1000, sells5m: 100 };
test('strong activity including sells cannot substitute for sellability evidence', () => {
  assert.equal(assessArcForAlert(market).alertable, false);
  for (const evidence of [null, {}, {is_honeypot:'1',cannot_sell_all:'0'},
    {is_honeypot:'0'}, {is_honeypot:'0',cannot_sell_all:'1'}]) {
    assert.equal(assessArcForAlert(market, arcBoostSafetyFromEvidence(evidence)).alertable, false);
  }
});
test('explicit sell safety passes but does not bypass other market or contract gates', () => {
  const safe = arcBoostSafetyFromEvidence({is_honeypot:'0',cannot_sell_all:'0'});
  assert.equal(assessArcForAlert(market, safe).alertable, true);
  assert.equal(assessArcForAlert({...market,liquidityUsd:null}, safe).alertable, false);
  assert.equal(assessArcForAlert({...market,hooks:'0x0000000000000000000000000000000000000001'}, safe).alertable, false);
});
