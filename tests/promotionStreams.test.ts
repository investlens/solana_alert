import test from 'node:test';import assert from 'node:assert/strict';
import {parsePromotionUpdate} from '../src/chains/robinhood/promotionStreams.js';
import {createPromotionPriorityQueue} from '../src/chains/robinhood/promotionPriorityQueue.js';
const token='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40);
test('handshake and incremental formats strip irrelevant payload and accept old tokens',()=>{
 const row={chainId:'robinhood',tokenAddress:token,description:'discard',icon:'discard',amount:10,totalAmount:20};
 assert.deepEqual(parsePromotionUpdate(JSON.stringify({limit:90,data:[row]}),'boost'),[{tokenAddress:token,amount:10,totalAmount:20}]);
 assert.deepEqual(parsePromotionUpdate(JSON.stringify([row]),'paid'),[{tokenAddress:token}]);
 assert.deepEqual(parsePromotionUpdate(JSON.stringify([{...row,chainId:'arc'},{...row,tokenAddress:'bad'},{...row,totalAmount:-1}]),'boost'),[]);
 assert.throws(()=>parsePromotionUpdate('{}','paid'));assert.throws(()=>parsePromotionUpdate('x'.repeat(1000001),'paid'));
});
test('paid priority is bounded, fair, retried on missing payment and deduplicated',()=>{
 const q=createPromotionPriorityQueue(2);assert.equal(q.admit([{tokenAddress:token},{tokenAddress:other}],1000),0);
 assert.equal(q.admit([{tokenAddress:'third'}],1000),1);
 assert.equal(q.next(1000),token);q.finish(token,false,1000);assert.equal(q.next(1000),other);q.finish(other,true,1000);
 assert.equal(q.next(2000),null);assert.equal(q.next(61000),token);q.finish(token,true,61000);
 q.admit([{tokenAddress:token}],62000);assert.equal(q.next(62000),null);
 q.admit([{tokenAddress:token}],122000);assert.equal(q.next(122000),token);
});
test('expired queue cannot replay stale candidates',()=>{const q=createPromotionPriorityQueue();q.admit([{tokenAddress:token}],1000);assert.equal(q.next(481000),null);assert.equal(q.size,0);});

test("provider heartbeat is a control message, not a promotion or snapshot",()=>{assert.equal(parsePromotionUpdate(JSON.stringify({type:"heartbeat"}),"boost"),null);assert.throws(()=>parsePromotionUpdate(JSON.stringify({type:"heartbeat",data:"invalid"}),"paid"));});
