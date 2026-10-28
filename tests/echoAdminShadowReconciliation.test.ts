import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileShadowIntent, type ChainEvidence } from '../src/echo/adminShadowReconciliation.js';
const base:ChainEvidence={
 intentState:'submitted',signature:'signed-tx',rpcHealthy:true,historyCaughtUp:true,
 blockhashExpired:false,verifiedFinalizedSuccess:false,verifiedFinalizedFailure:false,
 observedTokenIncrease:false,authoritativeSignatureStatus:false,
};
describe('Echo shadow reconciliation',()=>{
 it('never retries or releases reserved funds automatically',()=>{
  const cases:Partial<ChainEvidence>[]=[
   {},{rpcHealthy:false},{historyCaughtUp:false},{blockhashExpired:true},
   {verifiedFinalizedFailure:true,authoritativeSignatureStatus:true},
   {verifiedFinalizedSuccess:true,authoritativeSignatureStatus:true},
   {verifiedFinalizedSuccess:true,observedTokenIncrease:true},
  ];
  for(const patch of cases){
   const result=reconcileShadowIntent({...base,...patch});
   assert.equal(result.releaseReservedFunds,false);
   assert.equal(result.mayRetryPurchase,false);
   assert.notEqual(result.nextState,'confirmed');
  }
 });
 it('requires both finalized success and observed token increase',()=>{
  assert.equal(reconcileShadowIntent({...base,verifiedFinalizedSuccess:true,
   authoritativeSignatureStatus:true,observedTokenIncrease:true}).nextState,'confirmed');
 });
 it('keeps unknown on contradictory success and failure',()=>{
  assert.equal(reconcileShadowIntent({...base,verifiedFinalizedSuccess:true,
   verifiedFinalizedFailure:true,authoritativeSignatureStatus:true,
   observedTokenIncrease:true}).nextState,'unknown');
 });
 it('treats blockhash expiry as unresolved, never as permission to retry',()=>{
  const r=reconcileShadowIntent({...base,blockhashExpired:true});
  assert.equal(r.nextState,'expired_unresolved');
  assert.equal(r.mayRetryPurchase,false);
 });
});
