import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEchoLossBreaker } from '../src/echo/adminDailyLossBreaker.js';
const base={realizedLossLamports:100000000n,proposedAdditionalLossLamports:0n,
 dailyLimitLamports:150000000n,evidenceVerified:true,dayBoundaryVerified:true,emergencyStop:false};
describe('Echo daily loss breaker',()=>{
 it('allows shadow eligibility only below the verified cap',()=>{
  assert.equal(evaluateEchoLossBreaker(base).allowNewBuy,true);
 });
 it('blocks at the cap, projected cap, unknown day and stale evidence',()=>{
  for(const patch of [{realizedLossLamports:150000000n},
   {proposedAdditionalLossLamports:50000000n},{dayBoundaryVerified:false},
   {evidenceVerified:false},{emergencyStop:true},
   {dailyLimitLamports:151000000n}]){
   assert.equal(evaluateEchoLossBreaker({...base,...patch}).allowNewBuy,false);
  }
 });
});
