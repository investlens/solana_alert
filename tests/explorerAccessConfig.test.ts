import test from 'node:test';
import assert from 'node:assert/strict';
import {robinhoodExplorerAccess} from '../src/services/explorerAccessConfig.js';
test('official access is opt-in and explicit custom endpoints receive no key',()=>{
 assert.equal(robinhoodExplorerAccess({}).baseUrl,'https://robinhoodchain.blockscout.com/api/v2');
 assert.equal(robinhoodExplorerAccess({BLOCKSCOUT_API_KEY:'test-key'}).baseUrl,'https://api.blockscout.com/4663/api/v2');
 assert.equal(robinhoodExplorerAccess({BLOCKSCOUT_API_KEY:'test-key',ROBINHOOD_WALLET_EXPLORER_BASE_URL:'https://custom.example/api/v2'}).apiKey,undefined);
});
