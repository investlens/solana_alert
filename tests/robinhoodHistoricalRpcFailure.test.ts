import test from 'node:test';
import assert from 'node:assert/strict';
import { robinhoodRpcFailurePolicy } from '../src/chains/robinhood/rpc.js';

test('historical Robinhood state unavailable is a provider history limitation, not malformed params', () => {
 assert.equal(robinhoodRpcFailurePolicy(new Error('Missing or invalid parameters. historical state e676298a16f36ca1af56a6d629bb4240658d77ac5668f097c3eda107a4a6ff52 is not available')), 'HISTORY');
 assert.equal(robinhoodRpcFailurePolicy(new Error('Archive requests require a personal token. Get one at: https://example.invalid')), 'HISTORY');
});

test('genuinely invalid RPC parameters remain classified separately', () => {
 assert.equal(robinhoodRpcFailurePolicy(new Error('Invalid parameters were provided to the RPC method.')), 'PARAMETERS');
});
