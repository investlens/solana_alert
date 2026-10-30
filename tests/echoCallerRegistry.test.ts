import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ECHO_CALLERS, ECHO_MONITORED_CALLERS, ECHO_ALERT_CALLER_WALLETS,
 ECHO_MANUAL_BUY_CALLER_WALLETS, ECHO_SHADOW_CALLER_WALLETS,
 echoCallerByWallet, validateEchoCallers,
} from '../src/echo/callerRegistry.js';
test('registry monitors vetted callers and keeps permissions separate',()=>{
 assert.equal(ECHO_CALLERS.length,2);
 assert.equal(ECHO_MONITORED_CALLERS[0]?.id,'slingoor');
 assert.equal(ECHO_ALERT_CALLER_WALLETS.size,2);
 assert.equal(ECHO_SHADOW_CALLER_WALLETS.size,2);
 assert.equal(ECHO_MANUAL_BUY_CALLER_WALLETS.size,1);
 assert.equal(echoCallerByWallet(ECHO_MONITORED_CALLERS[0]!.wallet)?.displayName,'Slingoor');
 assert.equal(ECHO_CALLERS.some(c=>c.autoBuyEligible),false);
});
test('reject duplicate wallet and unauthorized auto-buy enablement',()=>{
 const first=ECHO_CALLERS[0]!;
 assert.throws(()=>validateEchoCallers([first,{...first,id:'duplicate'}]),/DUPLICATE_WALLET/);
 assert.throws(()=>validateEchoCallers([{...first,id:'additional',autoBuyEligible:true}]),/AUTO_BUY/);
 assert.throws(()=>validateEchoCallers([{...first,id:'additional',monitor:false}]),/REQUIRES_MONITORING/);
});
