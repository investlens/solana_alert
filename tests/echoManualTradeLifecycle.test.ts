import test from 'node:test';
import assert from 'node:assert/strict';
import {nextEchoTradeState,ECHO_REAL_BUY_ENABLED,ECHO_REAL_SELL_ENABLED,ECHO_AUTO_BUY_ENABLED,ECHO_AUTO_SELL_ENABLED,
 type TradeEvidence} from '../src/echo/manualTradeLifecycle.js';
import {ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED} from '../src/core/adminTrading.js';
const base:TradeEvidence={reservationKey:'wallet:mint',state:'RESERVED'};
const signature='3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1';
const fp='a'.repeat(64);
test('must have fresh quote and successful simulation before any submission evidence',()=>{
 assert.equal(nextEchoTradeState(base,{kind:'SUBMITTED',signature,fingerprint:fp}).ok,false);
 const quoted=nextEchoTradeState(base,{kind:'QUOTE_OK',nowMs:10000});
 assert.equal(quoted.ok,true);if(!quoted.ok)return;
 assert.equal(nextEchoTradeState(quoted.value,{kind:'SIMULATION_OK',nowMs:14001}).ok,false);
 const simulated=nextEchoTradeState(quoted.value,{kind:'SIMULATION_OK',nowMs:12000});
 assert.equal(simulated.ok,true);if(!simulated.ok)return;
 const sent=nextEchoTradeState(simulated.value,{kind:'SUBMITTED',signature,fingerprint:fp});
 assert.equal(sent.ok,true);if(!sent.ok)return;
 assert.equal(sent.value.state,'SUBMITTED');
 assert.equal(nextEchoTradeState(sent.value,{kind:'CHAIN_CONFIRMED',signature:'4'.repeat(64)}).ok,false);
 const done=nextEchoTradeState(sent.value,{kind:'CHAIN_CONFIRMED',signature});
 assert.equal(done.ok,true);if(!done.ok)return;
 assert.equal(done.value.state,'CONFIRMED');
 assert.equal(nextEchoTradeState(done.value,{kind:'QUOTE_OK',nowMs:20000}).ok,false);
});
test('uncertain send outcome forbids blind retries',()=>{
 const q=nextEchoTradeState(base,{kind:'QUOTE_OK',nowMs:10000});assert.ok(q.ok);if(!q.ok)return;
 const sim=nextEchoTradeState(q.value,{kind:'SIMULATION_OK',nowMs:10001});assert.ok(sim.ok);if(!sim.ok)return;
 const uncertain=nextEchoTradeState(sim.value,{kind:'SUBMISSION_RESULT_UNKNOWN',fingerprint:fp});
 assert.ok(uncertain.ok);if(!uncertain.ok)return;
 assert.equal(uncertain.value.state,'SUBMISSION_UNKNOWN');
 assert.equal(nextEchoTradeState(uncertain.value,{kind:'SUBMITTED',signature,fingerprint:fp}).ok,false);
 assert.equal(nextEchoTradeState(uncertain.value,{kind:'QUOTE_OK',nowMs:10002}).ok,false);
});
test('no real execution may be enabled through the lifecycle',()=>{
 assert.equal(ECHO_REAL_BUY_ENABLED,false);assert.equal(ECHO_REAL_SELL_ENABLED,false);
 assert.equal(ECHO_AUTO_BUY_ENABLED,false);assert.equal(ECHO_AUTO_SELL_ENABLED,false);
 assert.equal(ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED,true);
});
