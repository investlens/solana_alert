import test from 'node:test';
import assert from 'node:assert/strict';
import { robinhoodRpcFailureCooldown } from '../src/chains/robinhood/rpc.js';
test('blocked and rate-limited RPCs back off for five minutes; ordinary errors retain normal cooldown',()=>{
 for(const message of ['HTTP request failed. Status: 403 URL: private','HTTP 429','statusCode=403']) assert.equal(robinhoodRpcFailureCooldown(new Error(message),60000),300000);
 assert.equal(robinhoodRpcFailureCooldown(new Error('timeout'),60000),60000);
 assert.equal(robinhoodRpcFailureCooldown(new Error('Status: 403'),600000),600000);
});
