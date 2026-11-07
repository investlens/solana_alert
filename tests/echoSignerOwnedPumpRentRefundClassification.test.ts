import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEchoRentRefundPattern} from '../src/echo/signerOwnedPumpRentRefundClassification.js';
const matched={
 ledgerFailureReason:'UNEXPLAINED_PAYER_LAMPORT_BALANCE_CHANGE',
 observedPayerDeltaLamports:'45711275',
 outboundSystemDebitsLamports:'47194715',
 inboundSystemCreditsLamports:'0',
 messageNetworkFeeLamports:'5000',
 liveTokenAccountMinimumRentLamports:'1488440',
 closeToPayerCount:1,topLevelCloseToPayerCount:1,
 exactSameSimulationClosedAccount:true,
 closedSourceAbsentAtLaterRpcObservation:true
};
test('real observed rent-and-fee pattern identified but never reconciles or authorizes',()=>{
 const r=classifyEchoRentRefundPattern(matched);
 assert.equal(r.status,'RENT_PATTERN_MATCHED_NOT_AUDITED');
 assert.equal(r.inferredRentLamports,'1488440');
 assert.equal(r.conservativeDebitUpperLamports,'47199715');
 assert.equal(r.independentlyAuditedRefund,false);
 assert.equal(r.payerCpiLedgerReconciled,false);
 assert.equal(r.signingAllowed,false);
 assert.equal(r.broadcastAllowed,false);
});
test('never classify missing, duplicated, stale, unverified or forged close conditions',()=>{
 const changes=[
  {ledgerFailureReason:'SUCCESS'},{closeToPayerCount:0},
  {closeToPayerCount:2},{topLevelCloseToPayerCount:0},
  {exactSameSimulationClosedAccount:false},
  {closedSourceAbsentAtLaterRpcObservation:false},
  {liveTokenAccountMinimumRentLamports:'1488439'},
  {messageNetworkFeeLamports:'0'},{observedPayerDeltaLamports:'0'},
  {inboundSystemCreditsLamports:'1'}, // mismatched conservation, don't net guessing
  {outboundSystemDebitsLamports:'not_a_number'}
 ];
 for(const change of changes){
  const r=classifyEchoRentRefundPattern({...matched,...change});
  assert.equal(r.status,'RENT_PATTERN_NOT_PROVEN',JSON.stringify(change));
  assert.equal(r.signingAllowed,false);
  assert.equal(r.payerCpiLedgerReconciled,false);
 }
});
