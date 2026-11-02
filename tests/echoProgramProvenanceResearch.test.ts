import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEchoProgramProvenance,ECHO_PROGRAM_REVIEW_GRANTS_SIGNING,ECHO_PROGRAM_IDS}
 from '../src/echo/programProvenanceResearch.js';
const unknown='FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe';
test('unknown PumpPortal program cannot be promoted to a verified Pump program',()=>{
 const x=reviewEchoProgramProvenance({programIds:[unknown,ECHO_PROGRAM_IDS.pump]});
 assert.equal(x.ok,true);if(x.ok){
  assert.deepEqual(x.unrecognizedPrograms,[unknown]);
  assert.equal(x.noVerifiedImmutableBuild,true);
  assert.equal(x.executableBehaviorVerified,false);
  assert.equal(x.signingApproved,false);
 }
 assert.equal(ECHO_PROGRAM_REVIEW_GRANTS_SIGNING,false);
});
test('known ID with upgrade authority and a byte hash still cannot prove executable safety',()=>{
 const x=reviewEchoProgramProvenance({programIds:[ECHO_PROGRAM_IDS.pump],executableState:{
  [ECHO_PROGRAM_IDS.pump]:{executable:true,loader:'BPF upgradeable',
   programDataHash:'a'.repeat(64),upgradeAuthority:'owner'}
 }});
 assert.equal(x.ok,true);if(x.ok){
  assert.equal(x.noVerifiedImmutableBuild,true);
  assert.equal(x.executableBehaviorVerified,false);
  assert.equal(x.signingApproved,false);
 }
});
test('even immutable hashed program is observation only',()=>{
 const x=reviewEchoProgramProvenance({programIds:[ECHO_PROGRAM_IDS.pump],executableState:{
  [ECHO_PROGRAM_IDS.pump]:{executable:true,loader:'BPF upgradeable',
   programDataHash:'a'.repeat(64),upgradeAuthority:null}
 }});
 assert.equal(x.ok,true);if(x.ok){
  assert.equal(x.noVerifiedImmutableBuild,false);
  assert.equal(x.signingApproved,false);
  assert.equal(x.executableBehaviorVerified,false);
 }
});
