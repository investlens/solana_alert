import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEchoPilotNoRefundBudget}
 from '../src/echo/signerOwnedPilotNoRefundCostGate.js';
const base={
 scenarioCapCents:250 as const,solUsdUpperCents:'20000',
 reconstructedOutboundLamports:'10000000',
 independentlyQuotedNetworkFeeLamports:'5000'
};
test('pilot $2.50 accepts a strictly bounded no-refund COST diagnostic only',()=>{
 const r=evaluateEchoPilotNoRefundBudget(base);
 assert.equal(r.status,'CONSERVATIVE_UPPER_WITHIN_SCENARIO_CAP');
 assert.equal(r.upperCostCeilingCents,'201');
 assert.equal(r.conservativeUpperLamports,'10005000');
 assert.equal(r.signingAllowed,false);
 assert.equal(r.broadcastAllowed,false);
 assert.equal(r.allProgramDebitsProven,false);
 assert.equal(r.fxIsSignedOracle,false);
});
test('rent may NOT be subtracted from debit to fit $2.50',()=>{
 const r=evaluateEchoPilotNoRefundBudget({
  ...base,reconstructedOutboundLamports:'12900000'
 });
 assert.equal(r.status,'EXCEEDS_SCENARIO_CAP');
 assert.equal(r.upperCostCeilingCents,'259');
 assert.equal(r.signingAllowed,false);
});
test('negative, missing, huge and untrusted costs fail closed',()=>{
 for(const change of [
  {solUsdUpperCents:'0'},{solUsdUpperCents:'NaN'},
  {solUsdUpperCents:'100000000'},{reconstructedOutboundLamports:'0'},
  {reconstructedOutboundLamports:'1000000001'},
  {independentlyQuotedNetworkFeeLamports:'1000001'},
  {independentlyQuotedNetworkFeeLamports:'-1'}
 ]){
  const r=evaluateEchoPilotNoRefundBudget({...base,...change});
  assert.equal(r.status,'UNVERIFIED',JSON.stringify(change));
  assert.equal(r.signingAllowed,false);
 }
});
test('same debit may pass $5 but must fail $2.50',()=>{
 const spending='19000000',fx='20000';
 const args={...base,solUsdUpperCents:fx,reconstructedOutboundLamports:spending};
 const small=evaluateEchoPilotNoRefundBudget(args);
 const large=evaluateEchoPilotNoRefundBudget({...args,scenarioCapCents:500});
 assert.equal(small.status,'EXCEEDS_SCENARIO_CAP');
 assert.equal(large.status,'CONSERVATIVE_UPPER_WITHIN_SCENARIO_CAP');
});
