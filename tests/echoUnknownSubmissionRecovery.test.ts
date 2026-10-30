import test from 'node:test';
import assert from 'node:assert/strict';
import {nextEchoTradeState} from '../src/echo/manualTradeLifecycle.js';
const signature='3'.repeat(64),fingerprint='a'.repeat(64);
test('persist signature before uncertain broadcast and reconcile only from chain proof',()=>{
 const q=nextEchoTradeState({reservationKey:'w:m',state:'RESERVED'},{kind:'QUOTE_OK',nowMs:1000});
 assert.equal(q.ok,true);if(!q.ok)return;
 const s=nextEchoTradeState(q.value,{kind:'SIMULATION_OK',nowMs:1001});
 assert.equal(s.ok,true);if(!s.ok)return;
 const u=nextEchoTradeState(s.value,{kind:'SUBMISSION_RESULT_UNKNOWN',fingerprint,signature});
 assert.equal(u.ok,true);if(!u.ok)return;
 assert.equal(u.value.signature,signature);
 assert.equal(nextEchoTradeState(u.value,{kind:'QUOTE_OK',nowMs:1002}).ok,false);
 assert.equal(nextEchoTradeState(u.value,{kind:'CHAIN_CONFIRMED',signature:'4'.repeat(64)}).ok,false);
 const confirmed=nextEchoTradeState(u.value,{kind:'CHAIN_CONFIRMED',signature});
 assert.equal(confirmed.ok,true);
 if(confirmed.ok)assert.equal(confirmed.value.state,'CONFIRMED');
});
test('unknown-without-signature never authorizes a replayed transaction',()=>{
 const stuck={reservationKey:'w:m',state:'SUBMISSION_UNKNOWN' as const,transactionFingerprint:fingerprint};
 assert.equal(nextEchoTradeState(stuck,{kind:'CHAIN_CONFIRMED',signature}).ok,false);
 assert.equal(nextEchoTradeState(stuck,{kind:'SUBMITTED',signature,fingerprint}).ok,false);
});
