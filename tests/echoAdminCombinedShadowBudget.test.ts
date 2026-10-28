import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCombinedShadowBudget } from '../src/echo/adminCombinedShadowBudget.js';
const base={
 loss:{realizedLossLamports:0n,proposedAdditionalLossLamports:0n,
  dailyLimitLamports:150000000n,evidenceVerified:true,dayBoundaryVerified:true,emergencyStop:false},
 walletBalanceLamports:500000000n,reservedLamports:0n,minReserveLamports:100000000n,
 buyLamports:100000000n,feeCapLamports:1000000n,dailySpentLamports:0n,
 dailyGrossCapLamports:300000000n,openPositions:0,pendingPositions:0,
 walletFresh:true,rpcHealthy:true,reconciliationFresh:true,
};
describe('Echo combined shadow budget',()=>{
 it('never permits live execution',()=>{
  const r=evaluateCombinedShadowBudget(base);
  assert.equal(r.eligible,true);
  assert.equal(r.liveExecutionAllowed,false);
 });
 it('blocks loss cap, position cap, insufficient balance and stale RPC',()=>{
  for(const patch of [
   {loss:{...base.loss,realizedLossLamports:150000000n}},
   {pendingPositions:2},{walletBalanceLamports:100000000n},
   {rpcHealthy:false},{dailySpentLamports:250000000n},
  ]){
   const r=evaluateCombinedShadowBudget({...base,...patch});
   assert.equal(r.eligible,false);
   assert.equal(r.liveExecutionAllowed,false);
  }
 });
});
