import test from 'node:test';
import assert from 'node:assert/strict';
import {screenEchoPilotTotalBudget} from '../src/echo/pilotTotalBudgetGuard.js';
const good={
 spendableWalletCents:'3500',reservedAndOpenCents:'0',cumulativeCommittedCents:'0',
 newPrincipalCents:'940',allInBuyCostsCents:'60',
 exitAndNetworkReserveCents:'100',openOrPendingPositions:0,killSwitch:false,
 verifiedFreshSolUsd:true,verifiedBuyAndSellRoutes:true,durableReservationReady:true
} as const;
test('all-in entry at $10 passes as read-only, never execution permission',()=>{
 const result=screenEchoPilotTotalBudget({...good});
 assert.deepEqual(result,{eligible:true,executable:false,reason:'BUDGET_PREFLIGHT_ONLY',
  projectedCommittedCents:'1000',newAllInCents:'1000'});
});
test('a $10 principal cannot silently exceed the all-in $10 cap',()=>{
 assert.equal(screenEchoPilotTotalBudget({...good,newPrincipalCents:'1000'}).eligible,false);
 assert.equal(screenEchoPilotTotalBudget({...good,newPrincipalCents:'1001'}).eligible,false);
});
test('pilot budget includes existing commitments; blocks the third overspending trade',()=>{
 assert.equal(screenEchoPilotTotalBudget({...good,cumulativeCommittedCents:'2000'}).eligible,true);
 assert.deepEqual(screenEchoPilotTotalBudget({...good,cumulativeCommittedCents:'2001'}),
  {eligible:false,executable:false,reason:'PILOT_THIRTY_DOLLAR_CAP'});
});
test('pending or unknown funds remain reserved, network reserve survives',()=>{
 assert.equal(screenEchoPilotTotalBudget({...good,spendableWalletCents:'1500',
 reservedAndOpenCents:'500',exitAndNetworkReserveCents:'1'}).eligible,false);
 assert.equal(screenEchoPilotTotalBudget({...good,spendableWalletCents:'1501',
 reservedAndOpenCents:'500',exitAndNetworkReserveCents:'1'}).eligible,true);
});
test('fail closed for missing costs, stale data, unsupported routes and unsafe state',()=>{
 const bad=[
  {allInBuyCostsCents:null},{allInBuyCostsCents:'0'},
  {allInBuyCostsCents:'-2'},{allInBuyCostsCents:'2.5'},
  {exitAndNetworkReserveCents:'0'},{openOrPendingPositions:2},
  {openOrPendingPositions:-1},{killSwitch:true},
  {verifiedFreshSolUsd:false},{verifiedBuyAndSellRoutes:false},
  {durableReservationReady:false},{reservedAndOpenCents:'-1'},
  {cumulativeCommittedCents:'9007199254740991999999'}
 ] as const;
 for(const failure of bad)
  assert.equal(screenEchoPilotTotalBudget({...good,...failure}).eligible,false,
   JSON.stringify(failure));
});
