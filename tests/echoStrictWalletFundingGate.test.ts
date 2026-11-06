import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEchoFullWalletFunding,ECHO_FUNDING_GATE_ALLOWS_TRADING,
 type EchoFullWalletFundingInput} from '../src/echo/strictWalletFundingGate.js';
const base:EchoFullWalletFundingInput={
 swapInputLamports:'25000000',
 exactMessageFeeLamports:'10000',
 accountCreationRentLamports:'3000000',
 extraCpiWalletDebitLamports:'200000',
 manualSellFeeAndRentReserveLamports:'2000000',
 otherPendingCommitmentsLamports:'0',
 walletBalanceLamports:'0',
 solUsdPriceCents:'20000',
 alreadyCommittedLifetimeCents:'0',
 independentlyAuditedExactMessage:true,
 independentCpiAndAccountRentAudit:true,
 independentSellReserveAudit:true,
 freshWalletBalanceAndFxAttestation:true
};
test('wallet with zero SOL reports required funding but never enables trading',()=>{
 const r=reviewEchoFullWalletFunding(base);
 assert.equal(r.ok,false);
 assert.equal(r.reason,'UNFUNDED_FOR_FULL_BUY_AND_SELL_RESERVE');
 assert.equal(r.requiredFundingLamports,'30210000');
 assert.equal(r.walletShortfallLamports,'30210000');
 assert.equal(r.oneBuyAllInLamports,'28210000');
 assert.equal(r.oneBuyAllInUsdCents,'565');
 assert.equal(r.signingApproved,false);
 assert.equal(r.broadcastApproved,false);
 assert.equal(ECHO_FUNDING_GATE_ALLOWS_TRADING,false);
});
test('funded audited envelope is still only a read-only cost assessment',()=>{
 const r=reviewEchoFullWalletFunding({...base,walletBalanceLamports:'30210000'});
 assert.equal(r.ok,true);
 assert.equal(r.walletShortfallLamports,'0');
 assert.equal(r.lifetimeCommittedAfterCents,'565');
 assert.equal(r.signingApproved,false);
 assert.equal(r.broadcastApproved,false);
});
test('missing CPI, rent, exit reserve or funding attestations fail closed',()=>{
 for(const diff of [
  {accountCreationRentLamports:null},{extraCpiWalletDebitLamports:null},
  {manualSellFeeAndRentReserveLamports:null},
  {independentlyAuditedExactMessage:false},
  {independentCpiAndAccountRentAudit:false},
  {independentSellReserveAudit:false},
  {freshWalletBalanceAndFxAttestation:false},
  {exactMessageFeeLamports:null},
  {walletBalanceLamports:null},
  {solUsdPriceCents:null},
  {otherPendingCommitmentsLamports:null},
  {alreadyCommittedLifetimeCents:null},
 ])assert.equal(reviewEchoFullWalletFunding({...base,...diff}).ok,false);
});
test('includes pending commitments, not just this swap',()=>{
 const r=reviewEchoFullWalletFunding({...base,otherPendingCommitmentsLamports:'50000000'});
 assert.equal(r.requiredFundingLamports,'80210000');
 assert.equal(r.walletShortfallLamports,'80210000');
});
test('rejects extra unaudited cost exceeding $10 per order',()=>{
 const r=reviewEchoFullWalletFunding({...base,accountCreationRentLamports:'30000000'});
 assert.equal(r.reason,'TEN_DOLLAR_ALL_IN_ORDER_CAP');
});
test('enforces lifetime gross pilot budget and exact principal',()=>{
 assert.equal(reviewEchoFullWalletFunding({...base,alreadyCommittedLifetimeCents:'2500'}).reason,
  'THIRTY_DOLLAR_LIFETIME_CAP');
 assert.equal(reviewEchoFullWalletFunding({...base,swapInputLamports:'50000000'}).reason,
  'PILOT_PRINCIPAL_MUST_BE_0P025_SOL');
});
test('wonky amount or zero fee and reserve never pass',()=>{
 for(const diff of [
  {exactMessageFeeLamports:'0'}, {manualSellFeeAndRentReserveLamports:'0'},
  {solUsdPriceCents:'0'}, {swapInputLamports:'-25000000'},
  {walletBalanceLamports:'NaN'}, {accountCreationRentLamports:'1.5'}
 ])assert.equal(reviewEchoFullWalletFunding({...base,...diff}).ok,false);
});
