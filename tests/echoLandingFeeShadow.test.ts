import test from 'node:test';
import assert from 'node:assert/strict';
import {planEchoLandingFee,ECHO_FEE_PLANNER_SHADOW_ONLY} from '../src/echo/landingFeeShadow.js';
const writable=['8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'];
const samples=Array.from({length:20},(_,i)=>({slot:467000000+i,prioritizationFee:1000+i*1000}));
const good={samples,writableAccounts:writable,simulationUnitsConsumed:200000};
test('measured CU +10% margin and 75th fee percentile, no broadcast',()=>{
 const r=planEchoLandingFee(good);assert.equal(r.ok,true);
 if(r.ok){
  assert.equal(r.plan.computeUnitLimit,220000);
  assert.equal(r.plan.microLamportsPerCu,15000);
  assert.equal(r.plan.estimatedPriorityLamports,'3300');
  assert.equal(r.plan.estimatedBaseLamports,'5000');
  assert.equal(r.plan.totalEstimatedFeesLamports,'8300');
  assert.equal(r.plan.executable,false);assert.equal(r.plan.guaranteedLanding,false);
  assert.equal(r.plan.noBroadcastersConfigured,true);
 }
 assert.equal(ECHO_FEE_PLANNER_SHADOW_ONLY,true);
});
test('skip rather than bid above 0.0005 SOL additional fee ceiling',()=>{
 const high=samples.map(x=>({...x,prioritizationFee:3_000_000}));
 const r=planEchoLandingFee({...good,samples:high});
 assert.deepEqual(r,{ok:false,reason:'OBSERVED_LANDING_FEE_EXCEEDS_BUDGET_SKIP_TRADE',executable:false});
});
test('Jito tips are optional shadow comparison and must share capped budget',()=>{
 const r=planEchoLandingFee({...good,proposedJitoTipLamports:100_000n});
 assert.equal(r.ok,true);
 if(r.ok){assert.equal(r.plan.proposedTipLamports,'100000');
 assert.equal(r.plan.totalEstimatedFeesLamports,'108300');}
 const high=planEchoLandingFee({...good,proposedJitoTipLamports:500_000n});
 assert.equal(high.ok,false);
 assert.equal(high.ok?null:high.reason,'OBSERVED_LANDING_FEE_EXCEEDS_BUDGET_SKIP_TRADE');
});
test('unverified accounts, insufficient samples and missing simulated CU fail closed',()=>{
 assert.equal(planEchoLandingFee({...good,writableAccounts:[]}).ok,false);
 assert.equal(planEchoLandingFee({...good,samples:samples.slice(0,1)}).ok,false);
 assert.equal(planEchoLandingFee({...good,simulationUnitsConsumed:0}).ok,false);
 assert.equal(planEchoLandingFee({...good,maxPriorityAndTipLamports:600_000n}).ok,false);
});
test('invalid duplicate accounts and fee outliers rejected without retry',()=>{
 assert.equal(planEchoLandingFee({...good,writableAccounts:[...writable,...writable]}).ok,false);
 assert.equal(planEchoLandingFee({...good,samples:samples.map(v=>({...v,prioritizationFee:-1}))}).ok,false);
});
