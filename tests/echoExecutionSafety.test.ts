import test from 'node:test';
import assert from 'node:assert/strict';
import {assessEchoExecutionSafety, type EchoExecutionEvidence} from '../src/echo/executionSafety.js';
const policy={maxQuoteAgeSeconds:10,minLiquidityUsd:20000,maxBuyImpactPct:2,maxSellImpactPct:2,maxRoundTripFeePct:3};
const good: EchoExecutionEvidence={verifiedSwap:true,reliableTokenMint:true,quoteFreshSeconds:2,liquidityUsd:80000,
 simulatedBuyImpactPct:0.5,simulatedSellImpactPct:0.8,roundTripFeePct:1.2,canSimulateBuy:true,canSimulateSell:true,
 mintAuthorityDisabled:true,freezeAuthorityDisabled:true,concentrationChecked:true};
test('safe evidence can enter manual review, never auto-trade',()=>{assert.deepEqual(assessEchoExecutionSafety(good,policy),{eligibleForManualReview:true,reasons:[],automatedTradeAllowed:false});});
test('missing sell simulation blocks manual review',()=>{const d=assessEchoExecutionSafety({...good,canSimulateSell:false},policy);assert.equal(d.eligibleForManualReview,false);assert.ok(d.reasons.includes('unverified_round_trip_sellability'));});
test('stale quote, low liquidity, authority uncertainty and fees all block',()=>{
 const d=assessEchoExecutionSafety({...good,quoteFreshSeconds:20,liquidityUsd:100,roundTripFeePct:5,freezeAuthorityDisabled:null},policy);
 assert.equal(d.eligibleForManualReview,false);
 assert.deepEqual(d.reasons.sort(),['stale_or_missing_quote','insufficient_or_unknown_liquidity','round_trip_costs','token_authority_unverified'].sort());
});
test('missing data fails closed',()=>{const d=assessEchoExecutionSafety({...good,liquidityUsd:null,simulatedSellImpactPct:null},policy);assert.equal(d.eligibleForManualReview,false);assert.ok(d.reasons.includes('sell_price_impact'));});
