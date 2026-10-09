import test from 'node:test';
import assert from 'node:assert/strict';
import { robinhoodRpcFailureCooldown, robinhoodRpcFailurePolicy, robinhoodRpcOperationMethod } from '../src/chains/robinhood/rpc.js';
test('blocked and rate-limited RPCs back off for five minutes; ordinary errors retain normal cooldown',()=>{
 for(const message of ['HTTP request failed. Status: 403 URL: private','HTTP 429','statusCode=403']) assert.equal(robinhoodRpcFailureCooldown(new Error(message),60000),300000);
 assert.equal(robinhoodRpcFailureCooldown(new Error('timeout'),60000),60000);
 assert.equal(robinhoodRpcFailureCooldown(new Error('Status: 403'),600000),600000);
});

test('method and parameter errors do not classify a provider as unreachable; access denials keep backoff', () => {
 assert.equal(robinhoodRpcFailurePolicy(new Error('The method "eth_getLogs" does not exist / is not available.')), 'METHOD');
 assert.equal(robinhoodRpcFailurePolicy(new Error('Invalid parameters were provided to the RPC method.')), 'PARAMETERS');
 assert.equal(robinhoodRpcFailurePolicy(new Error('HTTP 403 method not available')), 'ACCESS');
 assert.equal(robinhoodRpcFailurePolicy(new Error('HTTP 429')), 'ACCESS');
 assert.equal(robinhoodRpcFailurePolicy(new Error('network timeout')), 'PROVIDER');
 assert.equal(robinhoodRpcOperationMethod('getLogs'), 'eth_getLogs');
 assert.equal(robinhoodRpcOperationMethod('getLogsChunk'), 'eth_getLogs');
 assert.equal(robinhoodRpcOperationMethod('blockNumber'), 'eth_blockNumber');
 assert.equal(robinhoodRpcOperationMethod('eth_call'), 'eth_call');
});
