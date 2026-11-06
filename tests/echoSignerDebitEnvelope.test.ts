import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileEchoSignerDebitEnvelope,ECHO_DEBIT_RECONCILIATION_CAN_SIGN,
 type EchoDebitEnvelope} from '../src/echo/signerDebitEnvelope.js';
const hash='a'.repeat(64);
const evidence:EchoDebitEnvelope={
 expectedUnsignedSha256:hash,
 probe:{ok:true,mode:'SIGNER_RPC_PROVISIONAL_ONLY',unsignedSha256:hash,
  payerBalanceBeforeLamports:'100000000',
  payerBalanceAfterSimulationLamports:'80000000',
  observedDeltaLamports:'20000000',networkFeeEstimateLamports:'5000',
  observedAtMs:1800000000000,simulationContextSlot:12345,
  innerInstructionCount:2,fullCpiAndExitProven:false,
  signingAllowed:false,broadcastAllowed:false},
 principalLamports:'19000000',independentlyBoundedRentLamports:'2000000',
 independentlyBoundedExtraCpiLamports:'100000',solUsdCents:'20000',
 sellReserveLamports:'2000000',pendingReservedLamports:'1000000',
 fullAccountAndCpiProvenanceVerified:true,sellRouteIndependentlyVerified:true
};
test('conservative envelope never grants execution',()=>{
 const r=reconcileEchoSignerDebitEnvelope(evidence);
 assert.deepEqual(r,{ok:true,mode:'OFFLINE_COST_ENVELOPE_ONLY',
  upperBuyDebitLamports:'22105000',allInCents:'443',
  requiredWalletLamports:'25105000',realExecutionApproved:false,
  signingAllowed:false,broadcastAllowed:false});
 assert.equal(ECHO_DEBIT_RECONCILIATION_CAN_SIGN,false);
});
test('incomplete independent evidence and $5 breaches fail closed',()=>{
 const bad=[
  {fullAccountAndCpiProvenanceVerified:false},
  {sellRouteIndependentlyVerified:false},
  {independentlyBoundedExtraCpiLamports:null},
  {independentlyBoundedRentLamports:null},
  {sellReserveLamports:null},
  {pendingReservedLamports:null},
  {expectedUnsignedSha256:'b'.repeat(64)},
  {independentlyBoundedExtraCpiLamports:'5000000'},
  {principalLamports:'21000000'},
  {probe:{...evidence.probe,observedDeltaLamports:'19000000'}},
  {probe:{...evidence.probe,payerBalanceBeforeLamports:'21000000'}}
 ];
 for(const patch of bad){
  const r=reconcileEchoSignerDebitEnvelope({...evidence,...patch} as EchoDebitEnvelope);
  assert.equal(r.ok,false,JSON.stringify(patch));
  assert.equal(r.signingAllowed,false);
 }
});
