import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShadowBudget, type BudgetSnapshot } from '../src/echo/adminShadowBudget.js';
const base:BudgetSnapshot={
 availableLamports:500_000_000n,reservedLamports:0n,minReserveLamports:100_000_000n,
 dailySpentLamports:0n,dailyGrossCapLamports:300_000_000n,
 dailyLossLamports:0n,dailyLossLimitLamports:150_000_000n,
 openPositions:0,pendingPositions:0,maxOpenPositions:2,reconciliationFresh:true,
 rpcHealthy:true,emergencyStop:false,mintAlreadyPurchased:false,
};
describe('Echo shadow budget',()=>{
 it('accepts only hypothetical safe budgets without authorizing execution',()=>{
  assert.deepEqual(evaluateShadowBudget(base,100_000_000n,1_000_000n),
   {shadowEligible:true,reason:'SHADOW_BUDGET_OK_NOT_EXECUTION_AUTHORIZATION'});
 });
 it('rejects insufficient funds, reserved funds, position cap, loss cap, stale dependencies',()=>{
  const bad:Partial<BudgetSnapshot>[]=[
   {emergencyStop:true},{reconciliationFresh:false},{rpcHealthy:false},
   {mintAlreadyPurchased:true},{openPositions:2},{openPositions:1,pendingPositions:1},
   {openPositions:-1},{dailyLossLamports:150_000_000n},
   {dailySpentLamports:250_000_000n},{availableLamports:100_000_000n},
   {reservedLamports:450_000_000n},{dailyGrossCapLamports:-1n},
  ];
  for(const patch of bad)assert.equal(evaluateShadowBudget({...base,...patch},100_000_000n,1_000_000n).shadowEligible,false,JSON.stringify(Object.keys(patch)));
 });
 it('rejects zero or over-cap stake',()=>{
  assert.equal(evaluateShadowBudget(base,0n,0n).shadowEligible,false);
  assert.equal(evaluateShadowBudget(base,100_000_001n,0n).shadowEligible,false);
 });
});
