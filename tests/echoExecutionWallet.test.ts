import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEchoExecutionWallet, ECHO_EXPECTED_EXECUTION_WALLET } from '../src/echo/executionWallet.js';
test('execution identity check rejects wrong and invalid addresses',()=>{
 assert.equal(verifyEchoExecutionWallet(ECHO_EXPECTED_EXECUTION_WALLET),true);
 assert.equal(verifyEchoExecutionWallet('not-an-address'),false);
 assert.equal(verifyEchoExecutionWallet('11111111111111111111111111111111'),false);
});
