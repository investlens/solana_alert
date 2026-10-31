import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileEchoBuys, type VerifiedBuy, type TelegramBuy } from '../src/echo/buyAcceptance.ts';
const expected:VerifiedBuy[]=[
 {caller:'Slingoor',signature:'sig1',mint:'mint1',tradeAt:100},
 {caller:'Chairman',signature:'sig2',mint:'mint2',tradeAt:110}
];
const delivered:TelegramBuy[]=[
 {caller:'Slingoor',signature:'sig1',mint:'mint1',messageId:11,deliveredAt:102},
 {caller:'Chairman',signature:'sig2',mint:'mint2',messageId:12,deliveredAt:113}
];
const cover=[{caller:'Slingoor',complete:true,from:90,to:150},{caller:'Chairman',complete:true,from:90,to:150}];
test('accepts independent complete BUY ledger matched to Telegram',()=>{
 const r=reconcileEchoBuys(expected,delivered,cover);
 assert.equal(r.accepted,true);assert.equal(r.matched,2);
});
test('fails closed for unverified high-volume pagination',()=>{
 const r=reconcileEchoBuys(expected,delivered,[{...cover[0],complete:false},cover[1]]);
 assert.equal(r.accepted,false);assert.deepEqual(r.incompleteCallers,['Slingoor']);
});
test('missing, duplicate, unexpected and late messages all block acceptance',()=>{
 assert.equal(reconcileEchoBuys(expected,delivered.slice(1),cover).missing.length,1);
 assert.equal(reconcileEchoBuys(expected,[...delivered,delivered[0]],cover).duplicateDeliveries.length,1);
 assert.equal(reconcileEchoBuys(expected,[...delivered,{...delivered[0],signature:'unknown',messageId:99}],cover).unexpectedDeliveries.length,1);
 assert.equal(reconcileEchoBuys(expected,[{...delivered[0],deliveredAt:120},delivered[1]],cover).lateDeliveries.length,1);
});
test('rejects fabricated coverage or reference double-counting',()=>{
 assert.throws(()=>reconcileEchoBuys([...expected,expected[0]],delivered,cover),/DUPLICATE_REFERENCE_BUY/);
 assert.throws(()=>reconcileEchoBuys(expected,delivered,[{...cover[0],from:101},cover[1]]),/BUY_OUTSIDE_COVERAGE/);
});
