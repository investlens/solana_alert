import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateSolanaDevHolding,
  classifySolanaTokenInstruction,
  mergeSolanaCoreMarketIntelligence,
  resolveSolanaCoreMarketIntelligence,
} from '../src/chains/solana/coreMarketIntelligence.js';
import {
  reuseRobinhoodDevTokenFlow,
  type DevTokenFlowResult,
} from '../src/chains/robinhood/security/devTokenFlowScanner.js';
import { analyzePonsPreIndexValuation } from '../src/chains/robinhood/ponsPreIndexValuation.js';

const mint = 'Mint111111111111111111111111111111111111111';
const creator = 'Creator11111111111111111111111111111111111';
const observed = new Date('2026-08-23T15:00:00.000Z');

test('Solana creator holding is verified for the correct mint including confirmed zero', async () => {
  const measured = await resolveSolanaCoreMarketIntelligence(mint, {
    resolveCreator: async () => creator,
    readSupply: async () => '1000000',
    readCreatorAccounts: async () => [{ mint, amountRaw: '25000' }],
    now: () => observed,
  });
  assert.equal(measured.devHolding.state, 'VERIFIED');
  assert.equal(measured.devHolding.value, 2.5);
  assert.equal(measured.devHolding.source, 'SOLANA_RPC_CREATOR_BALANCE_OVER_MINT_SUPPLY');

  const zero = await resolveSolanaCoreMarketIntelligence(mint, {
    resolveCreator: async () => creator,
    readSupply: async () => '1000000',
    readCreatorAccounts: async () => [],
    now: () => observed,
  });
  assert.deepEqual({ state: zero.devHolding.state, value: zero.devHolding.value }, {
    state: 'VERIFIED', value: 0,
  });
});

test('Solana unknown creator and wrong-mint balances never become holding evidence', async () => {
  const unknown = await resolveSolanaCoreMarketIntelligence(mint, {
    resolveCreator: async () => null,
    readSupply: async () => { throw new Error('must not run'); },
    readCreatorAccounts: async () => { throw new Error('must not run'); },
    now: () => observed,
  });
  assert.equal(unknown.devHolding.state, 'UNAVAILABLE');

  assert.throws(() => calculateSolanaDevHolding({
    mint, supplyRaw: '1000000',
    accounts: [{ mint: 'DifferentMint', amountRaw: '500000' }],
  }), /mint mismatch/);
  const rejected = await resolveSolanaCoreMarketIntelligence(mint, {
    resolveCreator: async () => creator,
    readSupply: async () => '1000000',
    readCreatorAccounts: async () => [{ mint: 'DifferentMint', amountRaw: '500000' }],
    now: () => observed,
  });
  assert.equal(rejected.devHolding.state, 'UNAVAILABLE');
});

test('Solana burn semantics recognize burn instructions but never ordinary transfers', () => {
  assert.equal(classifySolanaTokenInstruction('burn'), 'BURN');
  assert.equal(classifySolanaTokenInstruction('burnChecked'), 'BURN');
  assert.equal(classifySolanaTokenInstruction('transfer'), 'TRANSFER');
  assert.equal(classifySolanaTokenInstruction('transferChecked'), 'TRANSFER');
  assert.equal(classifySolanaTokenInstruction('closeAccount'), 'OTHER');
});

test('optional Solana enrichment failure leaves alert context deliverable', async () => {
  const unavailable = await resolveSolanaCoreMarketIntelligence(mint, {
    resolveCreator: async () => { throw new Error('RPC unavailable'); },
    readSupply: async () => '0',
    readCreatorAccounts: async () => [],
    now: () => observed,
  });
  const original = { symbol: 'SAFE', marketCap: 50_000 };
  assert.deepEqual(mergeSolanaCoreMarketIntelligence(original, unavailable), original);
});

test('verified Solana creator holding reaches the shared opportunity contract', async () => {
  const evidence = await resolveSolanaCoreMarketIntelligence(mint, {
    resolveCreator: async () => creator,
    readSupply: async () => '1000000',
    readCreatorAccounts: async () => [{ mint, amountRaw: '25000' }],
    now: () => observed,
  });
  const raw = mergeSolanaCoreMarketIntelligence({ symbol: 'ALPHA' }, evidence);
  const { buildOpportunityMessage } = await import('../src/services/opportunityDeliveryService.js');
  const message = buildOpportunityMessage({
    id: 501, asset_id: mint, chain: 'solana', opportunity_type: 'DEX_CONFIRMATION',
    source_agent: 'test', title: 'Alpha', why: 'Measured momentum.', what_happened: null,
    invalidation: null, risk_reason: null, confidence: 80, expected_profit: null,
    expected_profit_percent: null, risk_score: 20, status: 'NEW',
    recommended_action: 'BUY', strategy_key: 'SOL_MOMENTUM', revision: 1,
    updated_at: observed.toISOString(), expires_at: null, raw_data: raw,
  } as any);
  assert.match(message, /Dev holding\s+<b>2\.5%<\/b>/);
  assert.doesNotMatch(message, /Burned/);
});

test('Robinhood developer-flow evidence is reused across concurrent alert producers', async () => {
  let calls = 0;
  const result: DevTokenFlowResult = {
    tokenAddress: '0x1111111111111111111111111111111111111111',
    deployerAddress: '0x2222222222222222222222222222222222222222',
    devHoldingPercent: 2.5, devTokenBalance: 25_000, totalBurnPercent: 1.25,
    confirmedDevBurnPercent: 0, otherDevTransferPercent: 0,
    evidenceStatus: 'COMPLETE', scannedAt: observed.getTime(),
  };
  const loader = async () => { calls += 1; return result; };
  const [first, second] = await Promise.all([
    reuseRobinhoodDevTokenFlow(result.tokenAddress, loader),
    reuseRobinhoodDevTokenFlow(result.tokenAddress, loader),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.totalBurnPercent, 1.25);
  assert.equal(second.devHoldingPercent, 2.5);
});

test('PONS V1 and V2 do not fabricate pre-index USD valuation', () => {
  const v1 = analyzePonsPreIndexValuation({
    version: 'V1', quotePriceRaw: null, quoteDecimals: 18, quoteUsd: null,
    totalSupplyRaw: 1_000_000n * 10n ** 18n, tokenDecimals: 18, circulatingSupplyRaw: null,
  });
  assert.equal(v1.state, 'UNAVAILABLE');
  assert.ok(v1.missing.includes('quote price'));

  const v2MissingUsd = analyzePonsPreIndexValuation({
    version: 'V2', quotePriceRaw: 1_000_000_000_000n, quoteDecimals: 18, quoteUsd: null,
    totalSupplyRaw: 1_000_000n * 10n ** 18n, tokenDecimals: 18, circulatingSupplyRaw: null,
  });
  assert.equal(v2MissingUsd.state, 'UNAVAILABLE');
  assert.ok(v2MissingUsd.missing.includes('verified quote USD price'));

  const fdv = analyzePonsPreIndexValuation({
    version: 'V2', quotePriceRaw: 1_000_000_000_000n, quoteDecimals: 18, quoteUsd: 3_000,
    totalSupplyRaw: 1_000_000n * 10n ** 18n, tokenDecimals: 18, circulatingSupplyRaw: null,
  });
  assert.equal(fdv.state, 'VERIFIED_FDV');
  assert.notEqual(fdv.state, 'VERIFIED_MARKET_CAP');
});
