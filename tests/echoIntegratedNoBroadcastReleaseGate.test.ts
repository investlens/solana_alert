import test from 'node:test';
import assert from 'node:assert/strict';
import {assessEchoIntegratedRelease,ECHO_INTEGRATED_RELEASE_CAN_TRADE,
 type EchoIntegratedGateInput} from '../src/echo/integratedNoBroadcastReleaseGate.js';
function good():EchoIntegratedGateInput{return {
 entry:{ok:true,mode:'OFFLINE_COST_ENVELOPE_ONLY',
  upperBuyDebitLamports:'22105000',allInCents:'443',
  requiredWalletLamports:'25105000',realExecutionApproved:false,
  signingAllowed:false,broadcastAllowed:false},
 exits:{ok:true,mode:'READ_ONLY_PORTFOLIO_EXIT_BUDGET',
  requiredExitReserveLamports:'2110000',
  totalExistingWalletLamports:'100000000',
  realPhantomSellVerified:false,signingAllowed:false,broadcastAllowed:false},
 callerBuyVerifiedOnChain:true,sourceSignatureDurablyUnique:true,
 atomicWalletReservationVerified:true,persistentNonceVerified:true,
 liveTrustedCpiAdapterVerified:true,realWalletSimulationVerified:true,
 realPhantomExitVerified:true,isolatedRealKeySignedAndDiscardedVerified:true,
 manualKillSwitchIsOff:true
};}
test('even fully evidenced scenario is review-only, never grants signing',()=>{
 const r=assessEchoIntegratedRelease(good());
 assert.deepEqual(r,{status:'NO_BROADCAST_REVIEW',passedChecks:10,
  requiredChecks:10,unresolved:[],
  canSign:false,canBroadcast:false,canDeploy:false});
 assert.equal(ECHO_INTEGRATED_RELEASE_CAN_TRADE,false);
});
test('current real-world missing gates block, regardless of green CI',()=>{
 const x=good();
 x.liveTrustedCpiAdapterVerified=false;
 x.realWalletSimulationVerified=false;
 x.realPhantomExitVerified=false;
 x.isolatedRealKeySignedAndDiscardedVerified=false;
 const r=assessEchoIntegratedRelease(x);
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.passedChecks,6);
 assert.equal(r.unresolved.length,4);
 assert.equal(r.canBroadcast,false);
});
test('missing entry, exit, duplicate protection and kill-switch reject',()=>{
 const x=good();
 x.entry={ok:false,reason:'UNKNOWN_TRANSACTION_COST_COMPONENT',signingAllowed:false,broadcastAllowed:false};
 x.exits={ok:false,reason:'EXIT_QUOTE_UNVERIFIED',signingAllowed:false,broadcastAllowed:false};
 x.sourceSignatureDurablyUnique=false;
 x.manualKillSwitchIsOff=false;
 const r=assessEchoIntegratedRelease(x);
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.passedChecks,7);
 assert.deepEqual(r.unresolved,[
  'COMPLETE_ENTRY_ECONOMICS','PORTFOLIO_EXIT_RESERVES',
  'DURABLE_SOURCE_UNIQUENESS','ADMIN_KILL_SWITCH_ACTIVE']);
});
