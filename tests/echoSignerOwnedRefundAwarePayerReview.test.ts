import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEchoRefundAwarePayer} from '../src/echo/signerOwnedRefundAwarePayerReview.js';
const proof={
 observedDebitLamports:'18045055',
 outboundSystemDebitsLamports:'19528495',
 inboundSystemCreditsLamports:'0',
 independentlyEstimatedNetworkFeeLamports:'5000',
 independentlyQueriedTokenRentLamports:'1488440',
 independentRentRpcMatched:true,
 exactlyOneTopLevelCloseToPayer:true,
 sameSimulationCloseStateObserved:true
};
test('real $2.50 scenario is recognized as token-rent gap, not approved wallet accounting',()=>{
 const r=reviewEchoRefundAwarePayer(proof);
 assert.equal(r.status,'RENT_REFUND_ACCOUNTING_GAP');
 assert.equal(r.reason,'PAYER_TOKEN_RENT_REFUND_UNATTESTED');
 assert.equal(r.observedDebitLamports,'18045055');
 assert.equal(r.systemOutflowsPlusNetworkFeeLamports,'19533495');
 assert.equal(r.expectedRentRefundLamports,'1488440');
 assert.equal(r.differenceFromExactRentLamports,'0');
 assert.equal(r.signerEconomicAuthorization,false);
 assert.equal(r.completePayerLedgerReconciled,false);
 assert.equal(r.fullTokenDeliveryVerified,false);
 assert.equal(r.signingAllowed,false);
 assert.equal(r.broadcastAllowed,false);
});
test('adversarial mismatches cannot be classed as the known token-rent pattern',()=>{
 const variants=[
  {outboundSystemDebitsLamports:'19528494'},
  {observedDebitLamports:'18045056'},
  {inboundSystemCreditsLamports:'1'},
  {independentlyEstimatedNetworkFeeLamports:'4999'},
  {independentlyQueriedTokenRentLamports:'1488439'},
  {independentRentRpcMatched:false},
  {exactlyOneTopLevelCloseToPayer:false},
  {sameSimulationCloseStateObserved:false},
  {observedDebitLamports:'not-a-number'},
  {outboundSystemDebitsLamports:'999999999999'}
 ];
 for(const variant of variants){
  const r=reviewEchoRefundAwarePayer({...proof,...variant});
  assert.equal(r.status,'UNEXPLAINED_PAYER_EFFECT',JSON.stringify(variant));
  assert.equal(r.signingAllowed,false);
  assert.equal(r.completePayerLedgerReconciled,false);
  assert.equal(r.fullTokenDeliveryVerified,false);
 }
});
