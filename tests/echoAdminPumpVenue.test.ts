import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {classifyPumpVenue,PUMP_CURVE_PROGRAM,PUMP_SWAP_PROGRAM} from '../src/echo/adminPumpVenue.js';
describe('Echo Pump venue routing',()=>{
 it('recognizes supported programs but never claims a verified BUY',()=>{
  assert.deepEqual(classifyPumpVenue([PUMP_CURVE_PROGRAM]).venue,'pump_curve');
  assert.deepEqual(classifyPumpVenue([PUMP_SWAP_PROGRAM]).venue,'pump_swap');
  for(const ids of [[PUMP_CURVE_PROGRAM],[PUMP_SWAP_PROGRAM],
   [PUMP_CURVE_PROGRAM,PUMP_SWAP_PROGRAM],['11111111111111111111111111111111']]){
   assert.equal(classifyPumpVenue(ids).verifiedBuy,false);
  }
  assert.equal(classifyPumpVenue([PUMP_CURVE_PROGRAM,PUMP_SWAP_PROGRAM]).venue,'unsupported');
 });
});
