import test from 'node:test';
import assert from 'node:assert/strict';
import {previewEchoOwnerPositionSize,ECHO_INITIAL_BUY_LAMPORTS,
 ECHO_INITIAL_BUY_SOL,ECHO_SIZE_OPTIONS_SOL,ECHO_SIZE_EXECUTION_ENABLED}
 from '../src/echo/ownerPositionSizePolicy.js';
const base={
 requestedSol:'0.025' as const,approvedSol:'0.025' as const,
 explicitTierApproval:false,firstTradeAndManualExitVerified:false,
 solUsdCentsPerSol:20000,estimatedFeeAndOtherCostsCents:'75',
 cumulativeCommittedCents:'0'
};
test('phase one is 0.025 SOL and stays disabled',()=>{
 const r=previewEchoOwnerPositionSize(base);
 assert.deepEqual(r,{eligible:true,executable:false,lamports:'25000000',
 principalCents:'500',allInCents:'575',reason:'PREVIEW_ONLY'});
 assert.equal(ECHO_INITIAL_BUY_SOL,'0.025');
 assert.equal(ECHO_INITIAL_BUY_LAMPORTS,25_000_000n);
 assert.equal(ECHO_SIZE_EXECUTION_ENABLED,false);
 assert.deepEqual(ECHO_SIZE_OPTIONS_SOL,['0.025','0.1','0.2']);
});
test('larger tiers require separate explicit approval plus verified exit',()=>{
 for(const size of ['0.1','0.2'] as const){
  assert.equal(previewEchoOwnerPositionSize({...base,requestedSol:size}).reason,'OWNER_APPROVED_SIZE_MISMATCH');
  assert.equal(previewEchoOwnerPositionSize({...base,requestedSol:size,approvedSol:size}).reason,
   'SIZE_UPGRADE_NOT_APPROVED_OR_VALIDATED');
  assert.equal(previewEchoOwnerPositionSize({...base,requestedSol:size,approvedSol:size,
   explicitTierApproval:true}).reason,'SIZE_UPGRADE_NOT_APPROVED_OR_VALIDATED');
 }
});
test('higher tiers still enforce the $10 per-order cap at $200 SOL',()=>{
 for(const size of ['0.1','0.2'] as const){
  assert.equal(previewEchoOwnerPositionSize({...base,requestedSol:size,approvedSol:size,
   explicitTierApproval:true,firstTradeAndManualExitVerified:true}).reason,
   'EXCEEDS_INITIAL_TEN_DOLLAR_ALL_IN_CAP');
 }
});
test('fees and committed capital are included in conservative USD calculations',()=>{
 assert.equal(previewEchoOwnerPositionSize({...base,solUsdCentsPerSol:40000}).reason,
  'EXCEEDS_INITIAL_TEN_DOLLAR_ALL_IN_CAP');
 assert.equal(previewEchoOwnerPositionSize({...base,cumulativeCommittedCents:'2500'}).reason,
  'EXCEEDS_INITIAL_THIRTY_DOLLAR_LIFETIME_CAP');
 const r=previewEchoOwnerPositionSize({...base,solUsdCentsPerSol:19999});
 assert.equal(r.eligible,true);
 if(r.eligible)assert.equal(r.principalCents,'500');
 for(const changed of [{estimatedFeeAndOtherCostsCents:'0'},
  {estimatedFeeAndOtherCostsCents:'-5'},{solUsdCentsPerSol:0},
  {cumulativeCommittedCents:'bad'}]){
  assert.equal(previewEchoOwnerPositionSize({...base,...changed}).eligible,false);
 }
});
