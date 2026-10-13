import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePromotionUpdate} from '../src/chains/robinhood/promotionStreams.js';
test('promotion stream routes only exact ARC chain and valid events',()=>{
 const token='0x'+'a'.repeat(40),row={chainId:'arc',tokenAddress:token,amount:10,totalAmount:20};
 assert.deepEqual(parsePromotionUpdate(JSON.stringify([row]),'boost','arc'),[{tokenAddress:token,amount:10,totalAmount:20}]);
 assert.deepEqual(parsePromotionUpdate(JSON.stringify([row]),'boost'),[]);
 assert.deepEqual(parsePromotionUpdate(JSON.stringify([{...row,chainId:'robinhood'},{...row,amount:-1}]),'boost','arc'),[]);
 assert.equal(parsePromotionUpdate('{"type":"heartbeat"}','paid','arc'),null);
});
